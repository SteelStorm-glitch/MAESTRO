import type { ChatChunk, ChatMessage, Message, Role, ToolCall, ToolDefinition, Usage } from '@maestro/shared'
import { bus } from '../events/bus'
import { createMessage, ensureMessage } from '../db/repo/messages'
import { truncateMiddle, truncateToTokens } from '../lib/tokens'
import { maskSecrets } from '../lib/logger'
import { ToolCallAccumulator } from '../providers/base'
import type { ResolvedModel } from '../providers/registry'
import { executeTool, toolDefinitionsForRole, allowedToolsForRole, TOOL_CATALOG } from '../tools'
import { renderTemplate } from './prompts'
import type { ContextManager } from './context'

export class RunAbortedError extends Error {
  constructor(message = 'Запуск отменён') {
    super(message)
    this.name = 'RunAbortedError'
  }
}

export class BudgetExceededError extends Error {
  constructor(message = 'Исчерпан лимит токенов оркестра') {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

export interface AgentRuntime {
  sessionId: string
  root: string
  signal: AbortSignal
  roster: string
  context: ContextManager
  checkpoint(): Promise<void>
  assertBudget(): void
  addUsage(role: Role, model: ResolvedModel, usage: Usage, messageId: string | null): void
  setAgentStatus(role: Role, status: 'idle' | 'thinking' | 'tool' | 'done' | 'error', detail?: string): void
  requestApproval(role: Role, tool: string, args: Record<string, unknown>): Promise<boolean>
  onFileTouched(path: string, kind: 'created' | 'modified' | 'deleted' | 'moved'): void
  cheapestModel(): ResolvedModel | null
}

export interface AgentRunOptions {
  runtime: AgentRuntime
  role: Role
  model: ResolvedModel
  taskId?: string | null
  phase: string
  userPrompt: string
  extraSystem?: string
  history?: ChatMessage[]
  kind?: 'task' | 'result' | 'plan' | 'final' | 'system'
  maxSteps?: number
}

export interface AgentRunResult {
  text: string
  usage: Usage
  steps: number
  toolCalls: number
  stoppedBy?: string
}

function emitMessage(message: Message): void {
  bus.emitTransient(message.session_id, 'agent.message', {
    message_id: message.id,
    role_id: message.role_id,
    kind: message.kind,
    content: message.content,
    tokens_in: message.tokens_in,
    tokens_out: message.tokens_out,
    to_role_id: message.to_role_id,
  })
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function fileTouchFromTool(name: string, args: Record<string, unknown>): { path: string; kind: string } | null {
  const asString = (value: unknown) => (typeof value === 'string' ? value : null)
  switch (name) {
    case 'fs_write':
      return asString(args.path) ? { path: String(args.path), kind: 'modified' } : null
    case 'fs_append':
      return asString(args.path) ? { path: String(args.path), kind: 'modified' } : null
    case 'fs_delete':
      return asString(args.path) ? { path: String(args.path), kind: 'deleted' } : null
    case 'fs_move': {
      const target = asString(args.to)
      return target ? { path: target, kind: 'moved' } : null
    }
    default:
      return null
  }
}

/** Ask the model for a completion with tools, accumulating the stream into a single message. */
async function streamCompletion(opts: {
  runtime: AgentRuntime
  role: Role
  model: ResolvedModel
  messages: ChatMessage[]
  tools: ToolDefinition[]
  messageId: string
  kind: AgentRunOptions['kind']
}): Promise<{ text: string; toolCalls: ToolCall[]; usage: Usage; finishReason?: string }> {
  const { runtime, role, model, messages, tools } = opts
  const accumulator = new ToolCallAccumulator()
  let text = ''
  let usage: Usage = { input_tokens: 0, output_tokens: 0 }
  let finishReason: string | undefined

  const stream = model.adapter.chat(
    model.credentials,
    model.modelId,
    {
      messages,
      tools: tools.length > 0 ? tools : undefined,
      temperature: role.temperature,
      max_tokens: model.maxOutput,
    },
    runtime.signal,
  )

  for await (const chunk of stream as AsyncIterable<ChatChunk>) {
    if (chunk.type === 'text') {
      text += chunk.text
      bus.delta(runtime.sessionId, opts.messageId, role.id, chunk.text)
    } else if (chunk.type === 'tool_call_delta') {
      accumulator.push(chunk)
    } else if (chunk.type === 'usage') {
      usage = chunk.usage
    } else if (chunk.type === 'done') {
      finishReason = chunk.finish_reason
    } else if (chunk.type === 'error') {
      throw new Error(chunk.error.message)
    }
  }

  return { text, toolCalls: accumulator.result(), usage, finishReason }
}

/**
 * Run one agent: system prompt + conversation, tool-call loop, persistence and events.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const { runtime, role, model } = options
  const maxSteps = options.maxSteps ?? 14
  const kind = options.kind ?? 'task'
  const supportsTools = Boolean(model.supportsTools)
  const tools = supportsTools ? toolDefinitionsForRole(role) : []
  const toolNames = allowedToolsForRole(role)

  const system = [runtime.context.buildSystemPrompt(role, runtime.roster), options.extraSystem ? renderTemplate(options.extraSystem, {
    project_root: runtime.root,
    role_name: role.name,
    team_roster: runtime.roster,
  }) : '']
    .filter(Boolean)
    .join('\n\n')

  let messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...(options.history ?? []),
    { role: 'user', content: options.userPrompt },
  ]

  const maxContext = Math.max(8000, model.contextWindow)
  messages = await runtime.context.compressIfNeeded(messages, maxContext, async (text) => {
    const cheap = runtime.cheapestModel() ?? model
    if (cheap.modelDbId === model.modelDbId) return truncateToTokens(text, Math.floor(maxContext * 0.5))
    let summary = ''
    try {
      for await (const chunk of cheap.adapter.chat(
        cheap.credentials,
        cheap.modelId,
        {
          messages: [
            {
              role: 'system',
              content: 'Сожми диалог в компактную техническую сводку на русском. Сохрани факты, пути файлов, решения и открытые вопросы.',
            },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: Math.min(2000, cheap.maxOutput),
        },
        runtime.signal,
      )) {
        if (chunk.type === 'text') summary += chunk.text
      }
    } catch {
      summary = truncateToTokens(text, Math.floor(maxContext * 0.25))
    }
    bus.emit(runtime.sessionId, 'warn', {
      code: 'context_compressed',
      message: 'Контекст диалога сжат из-за лимита окна модели',
      role_id: role.id,
      role_name: role.name,
    })
    return summary || truncateToTokens(text, Math.floor(maxContext * 0.25))
  })

  const totalUsage: Usage = { input_tokens: 0, output_tokens: 0 }
  let steps = 0
  let totalToolCalls = 0
  let lastText = ''
  let stoppedBy: string | undefined
  let lastToolSignature = ''
  let repeatCount = 0

  // Text-protocol fallback for models without native tool calling.
  if (!supportsTools && tools.length === 0 && toolNames.length > 0) {
    const list = toolNames.map((name) => {
      const spec = TOOL_CATALOG[name]
      return `${spec.definition.name}: ${spec.definition.description} args=${JSON.stringify(spec.definition.parameters)}`
    })
    messages[0] = {
      role: 'system',
      content: `${system}\n\nИнструменты недоступны нативно. Если нужно действие, ответь РОВНО одним JSON-объектом {"tool":"имя","args":{...}} и без другого текста. Доступные инструменты:\n${list.join('\n')}`,
    }
  }

  for (let step = 0; step < maxSteps; step++) {
    await runtime.checkpoint()
    runtime.assertBudget()
    runtime.setAgentStatus(role, 'thinking')
    steps++

    const messageId = `msg_${runtime.sessionId.slice(0, 8)}_${role.id.slice(-6)}_${Date.now()}_${step}`
    const result = await streamCompletion({
      runtime,
      role,
      model,
      messages,
      tools,
      messageId,
      kind,
    })

    totalUsage.input_tokens += result.usage.input_tokens
    totalUsage.output_tokens += result.usage.output_tokens
    lastText = result.text || lastText

    if (result.text.trim()) {
      const assistantMessage = ensureMessage({
        id: messageId,
        session_id: runtime.sessionId,
        role_id: role.id,
        kind,
        content: result.text,
        tokens_in: result.usage.input_tokens,
        tokens_out: result.usage.output_tokens,
      })
      runtime.addUsage(role, model, result.usage, assistantMessage.id)
      emitMessage(assistantMessage)
    } else {
      runtime.addUsage(role, model, result.usage, null)
    }
    runtime.setAgentStatus(role, 'idle')

    // Native tool calls.
    if (result.toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: result.text, tool_calls: result.toolCalls })
      for (const call of result.toolCalls) {
        totalToolCalls++
        const signature = `${call.name}:${call.arguments}`
        if (signature === lastToolSignature) repeatCount++
        else {
          lastToolSignature = signature
          repeatCount = 1
        }
        if (repeatCount >= 3) {
          stoppedBy = 'Агент трижды подряд вызвал один и тот же инструмент с теми же аргументами — цикл остановлен'
          bus.emit(runtime.sessionId, 'warn', {
            code: 'tool_loop',
            message: stoppedBy,
            role_id: role.id,
            role_name: role.name,
            tool: call.name,
          })
          break
        }
        const output = await handleToolCall(runtime, role, call)
        messages.push({ role: 'tool', content: output, tool_call_id: call.id, name: call.name })
      }
      if (stoppedBy) break
      continue
    }

    // Text-protocol fallback parsing.
    if (!supportsTools && tools.length === 0 && toolNames.length > 0) {
      const parsed = parseTextToolCall(result.text)
      if (parsed && toolNames.includes(parsed.tool as never)) {
        totalToolCalls++
        const call: ToolCall = {
          id: `txt_${Date.now()}`,
          name: parsed.tool,
          arguments: JSON.stringify(parsed.args),
        }
        messages.push({ role: 'assistant', content: result.text })
        const output = await handleToolCall(runtime, role, call)
        messages.push({ role: 'user', content: `Результат инструмента ${call.name}:\n${output}` })
        continue
      }
    }

    return { text: result.text, usage: totalUsage, steps, toolCalls: totalToolCalls, stoppedBy }
  }

  return {
    text: lastText,
    usage: totalUsage,
    steps,
    toolCalls: totalToolCalls,
    stoppedBy: stoppedBy ?? 'Достигнут лимит шагов агента',
  }
}

function parseTextToolCall(text: string): { tool: string; args: Record<string, unknown> } | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && typeof parsed.tool === 'string') {
      return { tool: parsed.tool, args: (parsed.args ?? {}) as Record<string, unknown> }
    }
  } catch {
    /* not a tool call */
  }
  return null
}

async function handleToolCall(runtime: AgentRuntime, role: Role, call: ToolCall): Promise<string> {
  await runtime.checkpoint()
  const args = parseToolArgs(call.arguments)
  const callMessage = createMessage({
    session_id: runtime.sessionId,
    role_id: role.id,
    kind: 'tool_call',
    content: JSON.stringify({ tool: call.name, args }),
    tokens_out: 0,
  })
  emitMessage(callMessage)
  bus.emit(runtime.sessionId, 'agent.tool_call', {
    tool: call.name,
    args: truncateMiddle(maskSecrets(JSON.stringify(args)), 4000),
    role_id: role.id,
    role_name: role.name,
    message_id: callMessage.id,
  })
  runtime.setAgentStatus(role, 'tool', call.name)

  const approvalNeeded = call.name === 'shell_exec'
  if (approvalNeeded) {
    const allowed = await runtime.requestApproval(role, call.name, args)
    if (!allowed) {
      const denied = 'Отклонено пользователем: инструмент shell_exec не был разрешён.'
      const resultMessage = createMessage({
        session_id: runtime.sessionId,
        role_id: role.id,
        kind: 'tool_result',
        content: denied,
      })
      emitMessage(resultMessage)
      runtime.setAgentStatus(role, 'tool', `${call.name} отклонён`)
      return denied
    }
  }

  const result = await executeTool(
    {
      sessionId: runtime.sessionId,
      projectRoot: runtime.root,
      roleId: role.id,
      roleName: role.name,
      signal: runtime.signal,
    },
    role,
    call.name,
    args,
  )

  const fullContent = result.content.length > 200_000 ? `${result.content.slice(0, 200_000)}\n… (обрезано)` : result.content
  const resultMessage = createMessage({
    session_id: runtime.sessionId,
    role_id: role.id,
    kind: 'tool_result',
    content: fullContent,
  })
  emitMessage(resultMessage)
  bus.emit(runtime.sessionId, 'agent.tool_result', {
    tool: call.name,
    ok: result.ok,
    output: truncateMiddle(maskSecrets(fullContent), 4000),
    role_id: role.id,
    role_name: role.name,
    duration_ms: result.duration_ms,
    message_id: resultMessage.id,
  })

  const touch = fileTouchFromTool(call.name, args)
  if (touch) {
    try {
      runtime.onFileTouched(touch.path, touch.kind as 'created' | 'modified' | 'deleted' | 'moved')
    } catch {
      /* ignore */
    }
  }

  runtime.setAgentStatus(role, 'idle')
  return fullContent
}

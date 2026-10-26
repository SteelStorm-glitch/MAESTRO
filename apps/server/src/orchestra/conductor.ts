import type { Role } from '@maestro/shared'
import type { ResolvedModel } from '../providers/registry'
import { runAgent, type AgentRuntime } from './executor'
import { CONDUCTOR_PLAN_PROMPT, CONDUCTOR_REFINE_PROMPT, VERIFIER_PROMPT } from './prompts'

export interface PlanTask {
  id: string
  title: string
  assignee: string | null
  description: string
  depends_on: string[]
}

export interface PlanResult {
  tasks: PlanTask[]
  raw: string
}

export interface Verdict {
  verdict: 'pass' | 'issues'
  summary: string
  issues: Array<{ title: string; file?: string | null; description?: string }>
  raw: string
}

export interface RefineResult {
  type: 'final' | 'plan'
  text: string
  tasks?: PlanTask[]
  raw: string
}

/** Extract the first balanced, parseable JSON object from arbitrary model output. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const direct = tryParse(cleaned)
  if (direct) return direct

  // Try every opening brace in turn: prose may contain stray braced words like {App} before the JSON.
  let searchFrom = 0
  for (;;) {
    const start = cleaned.indexOf('{', searchFrom)
    if (start === -1) return null
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < cleaned.length; i++) {
      const char = cleaned[i]!
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}') {
        depth--
        if (depth === 0) {
          const candidate = tryParse(cleaned.slice(start, i + 1))
          if (candidate) return candidate
          break
        }
      }
    }
    searchFrom = start + 1
  }
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function normalisePlan(raw: Record<string, unknown>): PlanTask[] | null {
  const list = raw.tasks
  if (!Array.isArray(list)) return null
  const tasks: PlanTask[] = []
  list.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const obj = item as Record<string, unknown>
    const title = String(obj.title ?? '').trim()
    if (!title) return
    const deps = Array.isArray(obj.depends_on) ? obj.depends_on.map(String) : []
    tasks.push({
      id: String(obj.id ?? `t${index + 1}`).trim() || `t${index + 1}`,
      title,
      assignee: obj.assignee ? String(obj.assignee).trim() : null,
      description: String(obj.description ?? obj.details ?? '').trim() || title,
      depends_on: deps,
    })
  })
  return tasks
}

export async function requestPlan(
  runtime: AgentRuntime,
  role: Role,
  model: ResolvedModel,
  userTask: string,
  projectBrief: string,
  extraContext: string,
  history: Parameters<typeof runAgent>[0]['history'] = [],
): Promise<PlanResult> {
  const userPrompt = `Задача пользователя:\n${userTask}\n\n${projectBrief}${extraContext ? `\n\n${extraContext}` : ''}\n\nСоставь план. Ответ — только JSON.`
  let raw = (
    await runAgent({
      runtime,
      role,
      model,
      phase: 'plan',
      kind: 'plan',
      userPrompt,
      extraSystem: CONDUCTOR_PLAN_PROMPT,
      history,
      maxSteps: 3,
    })
  ).text

  let parsed = extractJsonObject(raw)
  let tasks = parsed ? normalisePlan(parsed) : null

  const correction = `Твой предыдущий ответ не является валидным JSON-планом. Предыдущий ответ:\n${raw.slice(0, 4000)}\n\nИсправь его и верни ТОЛЬКО JSON строго по схеме {"tasks":[{"id":"t1","title":"...","assignee":"...","description":"...","depends_on":[]}]} без markdown и комментариев.`
  const retryPrompt = `${userPrompt}\n\n${correction}`
  if (!parsed || !tasks) {
    runtime.context.summary += '\n(предыдущий ответ дирижёра не был валидным JSON — исправлено повторным запросом)'
    raw = (
      await runAgent({
        runtime,
        role,
        model,
        phase: 'plan',
        kind: 'plan',
        userPrompt: retryPrompt,
        extraSystem: CONDUCTOR_PLAN_PROMPT,
        history,
        maxSteps: 2,
      })
    ).text
    parsed = extractJsonObject(raw)
    tasks = parsed ? normalisePlan(parsed) : null
  }

  if (!tasks) {
    const error = new Error(`Дирижёр вернул невалидный план. Сырой ответ:\n${raw.slice(0, 3000)}`)
    ;(error as Error & { code?: string }).code = 'invalid_plan'
    throw error
  }

  return { tasks, raw }
}

export async function requestRefine(
  runtime: AgentRuntime,
  role: Role,
  model: ResolvedModel,
  userTask: string,
  outcomes: string,
  round: number,
  maxRounds: number,
  projectBrief: string,
): Promise<RefineResult> {
  const userPrompt = `Исходная задача:\n${userTask}\n\n${projectBrief}\n\nРезультаты раунда ${round}:\n${outcomes}\n\nРаунд ${round} из ${maxRounds}. Верни JSON: final или plan.`
  const raw = (
    await runAgent({
      runtime,
      role,
      model,
      phase: 'refine',
      kind: 'plan',
      userPrompt,
      extraSystem: CONDUCTOR_REFINE_PROMPT,
      maxSteps: 3,
    })
  ).text

  const parsed = extractJsonObject(raw)
  if (parsed && String(parsed.type) === 'final') {
    return { type: 'final', text: String(parsed.text ?? '').trim() || raw.trim(), raw }
  }
  if (parsed && (String(parsed.type) === 'plan' || Array.isArray(parsed.tasks))) {
    const tasks = normalisePlan(parsed)
    if (tasks) return { type: 'plan', text: '', tasks, raw }
  }
  return { type: 'final', text: raw.trim(), raw }
}

export async function requestReview(
  runtime: AgentRuntime,
  role: Role,
  model: ResolvedModel,
  userTask: string,
  outcomes: string,
  changedFiles: string,
): Promise<Verdict> {
  const userPrompt = `Задача пользователя:\n${userTask}\n\nРезультаты работы:\n${outcomes}\n\nИзменённые файлы:\n${changedFiles || '(нет данных)'}\n\nПроверь результат. Ответ — только JSON.`
  const raw = (
    await runAgent({
      runtime,
      role,
      model,
      phase: 'review',
      kind: 'result',
      userPrompt,
      extraSystem: VERIFIER_PROMPT,
      maxSteps: 8,
    })
  ).text

  const parsed = extractJsonObject(raw)
  if (!parsed) {
    return {
      verdict: 'issues',
      summary: 'Аудитор вернул неструктурированный ответ',
      issues: [{ title: 'Неструктурированный ответ аудитора', description: raw.slice(0, 2000) }],
      raw,
    }
  }
  const verdict = String(parsed.verdict ?? '').toLowerCase() === 'pass' ? 'pass' : 'issues'
  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((item) => {
        const obj = (item ?? {}) as Record<string, unknown>
        return {
          title: String(obj.title ?? 'Замечание'),
          file: obj.file ? String(obj.file) : null,
          description: String(obj.description ?? ''),
        }
      })
    : []
  return {
    verdict: verdict === 'pass' && issues.length === 0 ? 'pass' : 'issues',
    summary: String(parsed.summary ?? ''),
    issues,
    raw,
  }
}

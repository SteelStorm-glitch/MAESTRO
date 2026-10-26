import fs from 'node:fs'
import path from 'node:path'
import type { ChatMessage } from '@maestro/shared'
import { estimateMessagesTokens, estimateTokens, truncateToTokens } from '../lib/tokens'
import { buildTree } from '../tools/fs'
import { renderTemplate } from './prompts'
import type { Role } from '@maestro/shared'

export interface ProjectContext {
  tree: string
  readme: string
  rootName: string
}

export function readProjectContext(root: string): ProjectContext {
  let tree = ''
  try {
    const nodes = buildTree(root, 2, false)
    tree = renderTree(nodes, 0, 1200)
  } catch {
    tree = '(не удалось прочитать дерево)'
  }
  let readme = ''
  for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
    const candidate = path.join(root, name)
    if (fs.existsSync(candidate)) {
      try {
        readme = truncateToTokens(fs.readFileSync(candidate, 'utf8'), 1500)
      } catch {
        readme = ''
      }
      break
    }
  }
  return { tree, readme, rootName: path.basename(root) }
}

function renderTree(nodes: ReturnType<typeof buildTree>, level: number, maxLines: number): string {
  const lines: string[] = []
  const walk = (items: typeof nodes, depth: number) => {
    for (const node of items) {
      if (lines.length >= maxLines) return
      lines.push(`${'  '.repeat(depth)}${node.type === 'dir' ? `${node.name}/` : node.name}`)
      if (node.children?.length) walk(node.children, depth + 1)
    }
  }
  walk(nodes, level)
  if (lines.length >= maxLines) lines.push('…')
  return lines.join('\n')
}

/** Tracks compact session state shared between agents. */
export class ContextManager {
  summary = ''
  files = new Map<string, string>()
  userNotes: string[] = []
  readonly project: ProjectContext
  readonly root: string

  constructor(root: string) {
    this.root = root
    this.project = readProjectContext(root)
  }

  noteFile(filePath: string, description: string): void {
    const previous = this.files.get(filePath)
    this.files.set(filePath, description ? `${description}` : (previous ?? 'изменён'))
  }

  fileRegistryText(maxEntries = 120): string {
    if (this.files.size === 0) return '(пока нет файлов, изменённых агентами)'
    return [...this.files.entries()]
      .slice(-maxEntries)
      .map(([file, description]) => `- ${file}: ${description}`)
      .join('\n')
  }

  projectBrief(): string {
    const parts = [`Проект: ${this.project.rootName}`, `Дерево файлов:\n${this.project.tree}`]
    if (this.project.readme) parts.push(`README (фрагмент):\n${this.project.readme}`)
    if (this.summary) parts.push(`Сводка по сессии:\n${this.summary}`)
    return parts.join('\n\n')
  }

  buildSystemPrompt(role: Role, roster: string): string {
    return renderTemplate(role.system_prompt, {
      project_root: this.root,
      role_name: role.name,
      team_roster: roster,
    })
  }

  /**
   * Compress a long dialogue into a summary note. Returns the messages to send:
   * the original system instructions, a summary, and a structurally safe tail.
   */
  compressIfNeeded(
    messages: ChatMessage[],
    contextWindow: number,
    summarize: (text: string) => Promise<string>,
    threshold = 0.8,
  ): Promise<ChatMessage[]> {
    return (async () => {
      const estimated = estimateMessagesTokens(messages)
      const budget = Math.floor(contextWindow * threshold)
      if (estimated <= budget) return messages

      const systemMessages = messages.filter((message) => message.role === 'system')
      const conversation = messages.filter((message) => message.role !== 'system')
      let tailStart = Math.max(0, conversation.length - 4)

      // Never leave a tool result without the assistant tool call that produced it.
      while (tailStart > 0 && conversation[tailStart]?.role === 'tool') tailStart--
      while (
        tailStart > 0 &&
        conversation[tailStart - 1]?.role === 'assistant' &&
        (conversation[tailStart - 1]?.tool_calls?.length ?? 0) > 0
      ) {
        tailStart--
      }
      // Anthropic requires the first message to have role "user"; never start the tail on assistant/tool.
      while (tailStart < conversation.length && conversation[tailStart]?.role !== 'user') tailStart++
      if (tailStart >= conversation.length) {
        const lastUser = conversation.map((message) => message.role).lastIndexOf('user')
        tailStart = lastUser >= 0 ? lastUser : 0
      }
      const keepTail = conversation.slice(tailStart)
      const toSummarize = conversation.slice(0, tailStart)
      const serialise = (message: ChatMessage): string => {
        const calls = message.tool_calls?.length
          ? `\nВызовы инструментов: ${message.tool_calls.map((call) => `${call.name}(${call.arguments})`).join(', ')}`
          : ''
        const tool = message.role === 'tool' ? `\nРезультат инструмента ${message.name ?? 'unknown'} (${message.tool_call_id ?? 'без id'})` : ''
        return `${message.role}: ${message.content}${calls}${tool}`
      }
      const transcript = toSummarize.map(serialise).join('\n\n')
      let summary: string
      try {
        summary = await summarize(truncateToTokens(transcript, Math.floor(budget * 0.4)))
      } catch {
        summary = truncateToTokens(transcript, Math.floor(budget * 0.3))
      }
      this.summary = summary
      const summaryMessage: ChatMessage = {
        role: 'system',
        content: `Сводка предыдущего диалога (сжато из-за лимита контекста):\n${truncateToTokens(summary, Math.floor(budget * 0.35))}`,
      }
      return [...systemMessages, summaryMessage, ...keepTail]
    })()
  }
}

export function estimateContext(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0)
}

/** Cheap token estimate: ~3 characters per token works for mixed Russian/English + code. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 3))
}

export function estimateMessagesTokens(messages: Array<{ content: string; role?: string; tool_calls?: Array<{ name: string; arguments: string }> }>): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokens(m.content) + 4
    for (const call of m.tool_calls ?? []) {
      total += estimateTokens(`${call.name} ${call.arguments}`) + 8
    }
  }
  return total
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text
  const maxChars = Math.max(0, maxTokens * 3)
  return `${text.slice(0, maxChars)}\n… (обрезано)`
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.6)
  const tail = Math.max(0, maxChars - head - 20)
  return `${text.slice(0, head)}\n… (${text.length - head - tail} символов скрыто) …\n${text.slice(-tail)}`
}

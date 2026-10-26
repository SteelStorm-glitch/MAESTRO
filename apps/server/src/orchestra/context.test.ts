import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@maestro/shared'
import { ContextManager } from './context'

describe('context compression', () => {
  it('never starts the retained tail with an assistant message', async () => {
    const context = new ContextManager(process.cwd())
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'assistant', content: 'a3' },
      { role: 'assistant', content: 'a4' },
      { role: 'assistant', content: 'a5' },
    ]

    const compressed = await context.compressIfNeeded(messages, 1, async () => 'summary', 0.8)
    const conversation = compressed.filter((message) => message.role !== 'system')

    expect(conversation.length).toBeGreaterThan(0)
    expect(conversation[0]!.role).toBe('user')
  })
})

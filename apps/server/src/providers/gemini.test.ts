import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@maestro/shared'
import { buildContents } from './gemini'

describe('gemini buildContents', () => {
  it('extracts system messages into system prompt', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ]
    const { system, contents } = buildContents(messages)
    expect(system).toBe('You are a helpful assistant.')
    expect(contents).toHaveLength(1)
    expect(contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Hello' }],
    })
  })

  it('formats tool responses with role: function and object payload', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Run tool' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'search', arguments: '{"q":"vitest"}' }],
      },
      {
        role: 'tool',
        name: 'search',
        tool_call_id: 'call_1',
        content: JSON.stringify({ results: ['doc1', 'doc2'] }),
      },
    ]

    const { contents } = buildContents(messages)
    expect(contents).toHaveLength(3)
    expect(contents[1]?.role).toBe('model')
    expect(contents[1]?.parts[0]?.functionCall?.name).toBe('search')

    expect(contents[2]?.role).toBe('function')
    expect(contents[2]?.parts[0]?.functionResponse).toEqual({
      name: 'search',
      response: { results: ['doc1', 'doc2'] },
    })
  })

  it('wraps non-object/array tool results into { result } and merges consecutive tool results', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Run tools' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', name: 'list_files', arguments: '{}' },
          { id: 'c2', name: 'raw_cmd', arguments: '{}' },
        ],
      },
      {
        role: 'tool',
        name: 'list_files',
        tool_call_id: 'c1',
        content: '["file1.txt", "file2.txt"]',
      },
      {
        role: 'tool',
        name: 'raw_cmd',
        tool_call_id: 'c2',
        content: 'plain text output',
      },
    ]

    const { contents } = buildContents(messages)
    expect(contents).toHaveLength(3) // user, model, function
    expect(contents[2]?.role).toBe('function')
    expect(contents[2]?.parts).toHaveLength(2)
    expect(contents[2]?.parts[0]?.functionResponse).toEqual({
      name: 'list_files',
      response: { result: '["file1.txt", "file2.txt"]' },
    })
    expect(contents[2]?.parts[1]?.functionResponse).toEqual({
      name: 'raw_cmd',
      response: { result: 'plain text output' },
    })
  })
})

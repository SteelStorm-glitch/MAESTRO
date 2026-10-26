import { describe, expect, it } from 'vitest'
import { extractJsonObject } from './conductor'

describe('plan JSON extraction', () => {
  it('parses plain JSON', () => {
    const parsed = extractJsonObject('{"tasks":[{"id":"t1","title":"Do it"}]}')
    expect(parsed?.tasks).toHaveLength(1)
  })

  it('strips markdown fences', () => {
    const parsed = extractJsonObject('```json\n{"tasks":[]}\n```')
    expect(parsed).toEqual({ tasks: [] })
  })

  it('extracts JSON from prose', () => {
    const text = 'Вот план:\n{"tasks":[{"id":"t1","title":"A","depends_on":[]}]}\nГотово.'
    const parsed = extractJsonObject(text)
    expect(parsed?.tasks).toHaveLength(1)
  })

  it('handles braces inside strings', () => {
    const parsed = extractJsonObject('{"tasks":[{"title":"use {braces} carefully"}]}')
    expect(parsed?.tasks).toHaveLength(1)
  })

  it('ignores stray braces in prose before the JSON', () => {
    const parsed = extractJsonObject('Анализ компонента {App}: {"tasks":[{"id":"t1","title":"A"}]}')
    expect(parsed?.tasks).toHaveLength(1)
  })

  it('returns null for garbage', () => {
    expect(extractJsonObject('совсем не json')).toBeNull()
    expect(extractJsonObject('{"tasks": [')).toBeNull()
  })
})

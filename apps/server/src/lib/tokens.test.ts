import { describe, expect, it } from 'vitest'
import { estimateTokens, truncateMiddle, truncateToTokens } from './tokens'

describe('token estimation', () => {
  it('is monotonic with length', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hello')).toBeGreaterThan(0)
    expect(estimateTokens('hello world, this is longer')).toBeGreaterThan(estimateTokens('hello'))
  })

  it('truncates to a token budget', () => {
    const text = 'a'.repeat(3000)
    const truncated = truncateToTokens(text, 100)
    expect(truncated.length).toBeLessThan(text.length)
    expect(truncated).toContain('обрезано')
  })

  it('keeps both ends when truncating in the middle', () => {
    const text = `START${'x'.repeat(1000)}END`
    const result = truncateMiddle(text, 100)
    expect(result.startsWith('START')).toBe(true)
    expect(result.endsWith('END')).toBe(true)
  })
})

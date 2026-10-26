import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-crypto-'))

beforeAll(() => {
  process.env.MAESTRO_HOME = tempHome
})

afterAll(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

describe('crypto', () => {
  it('encrypts and decrypts secrets', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const secret = 'sk-test-1234567890abcdef'
    const enc = encryptSecret(secret)
    expect(enc).not.toContain(secret)
    expect(enc.startsWith('v1:')).toBe(true)
    expect(decryptSecret(enc)).toBe(secret)
  })

  it('produces different ciphertexts for the same plaintext', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const a = encryptSecret('same')
    const b = encryptSecret('same')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same')
    expect(decryptSecret(b)).toBe('same')
  })

  it('fails on tampered ciphertext', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto')
    const enc = encryptSecret('value')
    const parts = enc.split(':')
    parts[3] = Buffer.from('tampered').toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })

  it('masks keys for display', async () => {
    const { encryptSecret, maskKeyForDisplay } = await import('./crypto')
    expect(maskKeyForDisplay(encryptSecret('sk-abcdefgh1234'))).toBe('••••1234')
    expect(maskKeyForDisplay(null)).toBeNull()
  })
})

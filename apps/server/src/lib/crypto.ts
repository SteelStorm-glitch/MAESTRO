import crypto from 'node:crypto'
import fs from 'node:fs'
import { SECRET_PATH, ensureHome } from './paths'

const ALGO = 'aes-256-gcm'

let cachedKey: Buffer | null = null

export function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey
  ensureHome()
  let raw: string
  try {
    raw = fs.readFileSync(SECRET_PATH, 'utf8').trim()
  } catch {
    raw = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(SECRET_PATH, raw, { mode: 0o600 })
  }
  if (raw.length < 64) {
    // Re-create malformed key rather than crash; existing ciphertext becomes unreadable.
    raw = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(SECRET_PATH, raw, { mode: 0o600 })
  }
  cachedKey = Buffer.from(raw.slice(0, 64), 'hex')
  return cachedKey
}

/** Encrypt with AES-256-GCM. Output: v1:<iv b64>:<tag b64>:<cipher b64> */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, getMasterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':')
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted secret')
  const decipher = crypto.createDecipheriv(ALGO, getMasterKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

export function maskKeyForDisplay(enc: string | null | undefined): string | null {
  if (!enc) return null
  try {
    const plain = decryptSecret(enc)
    return `••••${plain.slice(-4)}`
  } catch {
    return '••••'
  }
}

export function tryDecrypt(enc: string | null | undefined): string | null {
  if (!enc) return null
  try {
    return decryptSecret(enc)
  } catch {
    return null
  }
}

export function newId(prefix = ''): string {
  const id = crypto.randomUUID()
  return prefix ? `${prefix}_${id}` : id
}

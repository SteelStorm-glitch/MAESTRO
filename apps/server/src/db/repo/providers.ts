import { asc, eq } from 'drizzle-orm'
import type { ExtraHeader, Provider, ProviderInput } from '@maestro/shared'
import { getDb } from '../client'
import { providers, type ProviderRow } from '../schema'
import { encryptSecret, maskKeyForDisplay, newId, tryDecrypt } from '../../lib/crypto'

export function toProvider(row: ProviderRow): Provider {
  let extra: ExtraHeader[] = []
  try {
    extra = JSON.parse(row.extraHeadersJson) as ExtraHeader[]
  } catch {
    extra = []
  }
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as Provider['protocol'],
    base_url: row.baseUrl,
    extra_headers: extra,
    timeout_ms: row.timeoutMs,
    created_at: row.createdAt,
    key_masked: maskKeyForDisplay(row.apiKeyEnc),
    has_key: Boolean(row.apiKeyEnc),
  }
}

export function listProviders(): Provider[] {
  return getDb().select().from(providers).orderBy(asc(providers.createdAt)).all().map(toProvider)
}

export function getProviderRow(id: string): ProviderRow | null {
  return getDb().select().from(providers).where(eq(providers.id, id)).get() ?? null
}

export function getProvider(id: string): Provider | null {
  const row = getProviderRow(id)
  return row ? toProvider(row) : null
}

export function getProviderCredentials(id: string) {
  const row = getProviderRow(id)
  if (!row) return null
  let extra_headers: ExtraHeader[] = []
  try {
    extra_headers = JSON.parse(row.extraHeadersJson) as ExtraHeader[]
  } catch {
    extra_headers = []
  }
  return {
    protocol: row.protocol as Provider['protocol'],
    base_url: row.baseUrl,
    api_key: tryDecrypt(row.apiKeyEnc),
    extra_headers,
    timeout_ms: row.timeoutMs,
    name: row.name,
  }
}

export function createProvider(input: ProviderInput): Provider {
  const id = newId('prv')
  const now = Date.now()
  getDb()
    .insert(providers)
    .values({
      id,
      name: input.name,
      protocol: input.protocol,
      baseUrl: input.base_url.replace(/\/+$/, ''),
      apiKeyEnc: input.api_key ? encryptSecret(input.api_key) : null,
      extraHeadersJson: JSON.stringify(input.extra_headers ?? []),
      timeoutMs: input.timeout_ms ?? 120000,
      createdAt: now,
    })
    .run()
  return getProvider(id)!
}

export function updateProvider(id: string, input: Partial<ProviderInput>): Provider | null {
  const row = getProviderRow(id)
  if (!row) return null
  const values: Partial<ProviderRow> = {}
  if (input.name !== undefined) values.name = input.name
  if (input.protocol !== undefined) values.protocol = input.protocol
  if (input.base_url !== undefined) values.baseUrl = input.base_url.replace(/\/+$/, '')
  if (input.api_key !== undefined) values.apiKeyEnc = input.api_key ? encryptSecret(input.api_key) : null
  if (input.extra_headers !== undefined) values.extraHeadersJson = JSON.stringify(input.extra_headers)
  if (input.timeout_ms !== undefined) values.timeoutMs = input.timeout_ms
  getDb().update(providers).set(values).where(eq(providers.id, id)).run()
  return getProvider(id)
}

export function deleteProvider(id: string): boolean {
  const res = getDb().delete(providers).where(eq(providers.id, id)).run()
  return res.changes > 0
}

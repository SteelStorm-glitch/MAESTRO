import { asc, eq } from 'drizzle-orm'
import type { Message, MessageKind } from '@maestro/shared'
import { getDb } from '../client'
import { messages, type MessageRow } from '../schema'
import { newId } from '../../lib/crypto'

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    session_id: row.sessionId,
    role_id: row.roleId,
    kind: row.kind as MessageKind,
    to_role_id: row.toRoleId,
    content: row.content,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    created_at: row.createdAt,
  }
}

export function listMessages(sessionId: string): Message[] {
  return getDb()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt))
    .all()
    .map(toMessage)
}

export function getMessage(id: string): Message | null {
  const row = getDb().select().from(messages).where(eq(messages.id, id)).get()
  return row ? toMessage(row) : null
}

export function createMessage(input: {
  session_id: string
  role_id?: string | null
  kind: MessageKind
  to_role_id?: string | null
  content: string
  tokens_in?: number
  tokens_out?: number
  id?: string
}): Message {
  const id = input.id ?? newId('msg')
  getDb()
    .insert(messages)
    .values({
      id,
      sessionId: input.session_id,
      roleId: input.role_id ?? null,
      kind: input.kind,
      toRoleId: input.to_role_id ?? null,
      content: input.content,
      tokensIn: input.tokens_in ?? 0,
      tokensOut: input.tokens_out ?? 0,
      createdAt: Date.now(),
    })
    .run()
  return getMessage(id)!
}

/** Insert only if missing — used to snapshot streamed assistant messages. */
export function ensureMessage(input: Parameters<typeof createMessage>[0]): Message {
  const existing = input.id ? getMessage(input.id) : null
  if (existing) {
    if (existing.content !== input.content) {
      getDb()
        .update(messages)
        .set({
          content: input.content,
          tokensIn: input.tokens_in ?? existing.tokens_in,
          tokensOut: input.tokens_out ?? existing.tokens_out,
        })
        .where(eq(messages.id, existing.id))
        .run()
      return getMessage(existing.id)!
    }
    return existing
  }
  return createMessage(input)
}

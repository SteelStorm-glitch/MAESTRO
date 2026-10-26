import { EventEmitter } from 'node:events'
import type { EventRecord, EventType, FsChange, SessionStatus, StreamEnvelope, Task } from '@maestro/shared'
import { insertEvent } from '../db/repo/events'

type Listener = (envelope: StreamEnvelope) => void

class EventBus {
  private emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(200)
  }

  /** Persist an event and fan it out to every SSE subscriber. */
  emit(sessionId: string | null, type: EventType, payload: unknown = {}): EventRecord {
    const record = insertEvent({ session_id: sessionId, type, payload })
    this.emitter.emit('envelope', { channel: 'event', event: record } satisfies StreamEnvelope)
    return record
  }

  /**
   * Broadcast a UI-only event without writing it to the events table.
   * Used for high-frequency status/usage/message signals already stored elsewhere.
   */
  emitTransient(sessionId: string | null, type: EventType, payload: unknown = {}): EventRecord {
    const record: EventRecord = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      session_id: sessionId,
      type,
      payload,
      created_at: Date.now(),
    }
    this.emitter.emit('envelope', { channel: 'event', event: record } satisfies StreamEnvelope)
    return record
  }

  delta(sessionId: string, messageId: string, roleId: string | null, text: string): void {
    this.emitter.emit('envelope', {
      channel: 'delta',
      session_id: sessionId,
      message_id: messageId,
      role_id: roleId,
      text,
    } satisfies StreamEnvelope)
  }

  sessionState(session: {
    id: string
    status: SessionStatus
    tokens_in: number
    tokens_out: number
    cost: number
  }): void {
    this.emitter.emit('envelope', {
      channel: 'session',
      session: {
        id: session.id,
        status: session.status,
        tokens_in: session.tokens_in,
        tokens_out: session.tokens_out,
        cost: session.cost,
      },
    } satisfies StreamEnvelope)
  }

  tasks(sessionId: string, tasks: Task[]): void {
    this.emitter.emit('envelope', { channel: 'tasks', session_id: sessionId, tasks } satisfies StreamEnvelope)
  }

  fsChange(change: FsChange): void {
    this.emitter.emit('envelope', { channel: 'fs', change } satisfies StreamEnvelope)
  }

  subscribe(listener: Listener): () => void {
    this.emitter.on('envelope', listener)
    return () => this.emitter.off('envelope', listener)
  }
}

export const bus = new EventBus()

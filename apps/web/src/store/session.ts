import { create } from 'zustand'
import type {
  ApprovalRequest,
  EventRecord,
  Message,
  Project,
  ProviderRequestPayload,
  SessionDetail,
  SessionStatus,
  Task,
} from '@maestro/shared'
import { api } from '../api/client'
import { openSessionStream } from '../api/sse'
import { useAppStore } from './app'
import { useFilesStore } from './files'

export interface PendingMessage {
  id: string
  roleId: string | null
  text: string
  startedAt: number
}

export interface AgentStatusEntry {
  status: 'idle' | 'thinking' | 'tool' | 'done' | 'error'
  detail?: string
  updatedAt: number
}

interface SessionState {
  sessionId: string | null
  session: SessionDetail | null
  project: Project | null
  messages: Message[]
  pending: Record<string, PendingMessage>
  tasks: Task[]
  events: EventRecord[]
  approvals: ApprovalRequest[]
  requests: ProviderRequestPayload[]
  agentStatus: Record<string, AgentStatusEntry>
  status: SessionStatus
  tokensIn: number
  tokensOut: number
  cost: number
  loading: boolean
  connected: boolean
  reconnecting: boolean
  roleFilter: string | null
  autoScroll: boolean
  unread: number

  connect: (sessionId: string) => Promise<void>
  disconnect: () => void
  reload: () => Promise<void>
  loadEvents: () => Promise<void>
  refreshRequests: () => Promise<void>
  send: (text: string, toRoleId?: string | null) => Promise<void>
  cancel: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  approve: (approvalId: string, allow: boolean) => Promise<void>
  setRoleFilter: (roleId: string | null) => void
  setAutoScroll: (value: boolean) => void
  clearUnread: () => void
  handleEnvelope: (envelope: unknown) => void
}

let cleanupStream: (() => void) | null = null
let requestsTimer: number | null = null

const MAX_EVENTS = 3000
const MAX_REQUESTS = 300

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionId: null,
  session: null,
  project: null,
  messages: [],
  pending: {},
  tasks: [],
  events: [],
  approvals: [],
  requests: [],
  agentStatus: {},
  status: 'idle',
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
  loading: false,
  connected: false,
  reconnecting: false,
  roleFilter: null,
  autoScroll: true,
  unread: 0,

  connect: async (sessionId) => {
    cleanupStream?.()
    cleanupStream = null
    set({
      sessionId,
      loading: true,
      messages: [],
      pending: {},
      tasks: [],
      events: [],
      approvals: [],
      agentStatus: {},
      roleFilter: null,
      unread: 0,
    })
    try {
      const [detail, messages, tasks, events] = await Promise.all([
        api.sessions.get(sessionId),
        api.sessions.messages(sessionId),
        api.sessions.tasks(sessionId),
        api.events({ session: sessionId, limit: 800 }),
      ])
      const markers: Record<string, 'created' | 'modified' | 'deleted'> = {}
      for (const event of events) {
        if (!event.type.startsWith('fs.')) continue
        const payload = event.payload as { path?: string }
        if (!payload?.path) continue
        markers[payload.path] =
          event.type === 'fs.create' ? 'created' : event.type === 'fs.delete' ? 'deleted' : 'modified'
      }
      useFilesStore.getState().setHistory(markers)
      set({
        session: detail,
        project: detail.project ?? null,
        messages,
        tasks,
        events,
        approvals: detail.approvals ?? [],
        status: detail.status,
        tokensIn: detail.tokens_in,
        tokensOut: detail.tokens_out,
        cost: detail.cost,
        loading: false,
      })
    } catch (error) {
      set({ loading: false })
      useAppStore.getState().handleError(error)
      return
    }

    cleanupStream = openSessionStream(
      sessionId,
      (envelope) => get().handleEnvelope(envelope),
      (connected) => set({ connected, reconnecting: !connected }),
    )
    void get().refreshRequests()
  },

  disconnect: () => {
    cleanupStream?.()
    cleanupStream = null
    useFilesStore.getState().setHistory({})
    set({ sessionId: null, session: null, connected: false, messages: [], pending: {}, tasks: [] })
  },

  reload: async () => {
    const id = get().sessionId
    if (!id) return
    const [detail, messages, tasks] = await Promise.all([
      api.sessions.get(id),
      api.sessions.messages(id),
      api.sessions.tasks(id),
    ])
    set({
      session: detail,
      messages,
      tasks,
      approvals: detail.approvals ?? [],
      status: detail.status,
      tokensIn: detail.tokens_in,
      tokensOut: detail.tokens_out,
      cost: detail.cost,
    })
  },

  loadEvents: async () => {
    const id = get().sessionId
    if (!id) return
    try {
      const events = await api.events({ session: id, limit: 800 })
      set({ events })
    } catch {
      /* ignore */
    }
  },

  refreshRequests: async () => {
    try {
      const requests = (await api.events({ types: 'provider.request', limit: MAX_REQUESTS })) as unknown as EventRecord[]
      const payloads = requests
        .map((event) => event.payload as ProviderRequestPayload)
        .filter((payload): payload is ProviderRequestPayload => Boolean(payload && typeof payload === 'object'))
        .reverse()
      set({ requests: payloads.slice(-MAX_REQUESTS) })
    } catch {
      /* ignore */
    }
  },

  send: async (text, toRoleId) => {
    const id = get().sessionId
    if (!id) return
    await api.sessions.message(id, text, toRoleId ?? null)
    set({ autoScroll: true })
  },

  cancel: async () => {
    const id = get().sessionId
    if (!id) return
    await api.sessions.cancel(id)
  },

  pause: async () => {
    const id = get().sessionId
    if (!id) return
    await api.sessions.pause(id)
  },

  resume: async () => {
    const id = get().sessionId
    if (!id) return
    await api.sessions.resume(id)
  },

  approve: async (approvalId, allow) => {
    const id = get().sessionId
    if (!id) return
    try {
      await api.sessions.approve(id, approvalId, allow)
      set({ approvals: get().approvals.filter((item) => item.id !== approvalId) })
    } catch (error) {
      useAppStore.getState().handleError(error)
    }
  },

  setRoleFilter: (roleId) => set({ roleFilter: roleId }),
  setAutoScroll: (value) => set({ autoScroll: value, unread: value ? 0 : get().unread }),
  clearUnread: () => set({ unread: 0 }),

  handleEnvelope: (raw) => {
    const envelope = raw as {
      channel?: string
      event?: EventRecord
      session_id?: string
      message_id?: string
      role_id?: string | null
      text?: string
      session?: { id: string; status: SessionStatus; tokens_in: number; tokens_out: number; cost: number }
      tasks?: Task[]
      change?: { path?: string; type?: string }
    }
    if (!envelope.channel) return

    if (envelope.channel === 'delta') {
      if (!envelope.message_id) return
      const existing = get().pending[envelope.message_id]
      set({
        pending: {
          ...get().pending,
          [envelope.message_id]: {
            id: envelope.message_id,
            roleId: envelope.role_id ?? null,
            text: `${existing?.text ?? ''}${envelope.text ?? ''}`,
            startedAt: existing?.startedAt ?? Date.now(),
          },
        },
        unread: get().autoScroll ? get().unread : get().unread + 1,
      })
      return
    }

    if (envelope.channel === 'session' && envelope.session) {
      const statusChanged = get().status !== envelope.session.status
      set({
        status: envelope.session.status,
        tokensIn: envelope.session.tokens_in,
        tokensOut: envelope.session.tokens_out,
        cost: envelope.session.cost,
      })
      if (statusChanged && ['done', 'error', 'cancelled'].includes(envelope.session.status)) {
        // A finished run cannot emit more deltas — drop any half-streamed message.
        set({ pending: {} })
        void useAppStore.getState().refreshSessions()
        void get().reload()
      }
      return
    }

    if (envelope.channel === 'tasks') {
      set({ tasks: envelope.tasks ?? [] })
      return
    }

    if (envelope.channel !== 'event' || !envelope.event) return
    const event = envelope.event
    const events = [...get().events, event].slice(-MAX_EVENTS)
    set({ events })

    switch (event.type) {
      case 'agent.message': {
        const payload = event.payload as {
          message_id: string
          role_id: string | null
          kind: Message['kind']
          content: string
          tokens_in?: number
          tokens_out?: number
          to_role_id?: string | null
        }
        if (!payload?.message_id) break
        const pending = { ...get().pending }
        delete pending[payload.message_id]
        const message: Message = {
          id: payload.message_id,
          session_id: get().sessionId ?? '',
          role_id: payload.role_id,
          kind: payload.kind,
          to_role_id: payload.to_role_id ?? null,
          content: payload.content,
          tokens_in: payload.tokens_in ?? 0,
          tokens_out: payload.tokens_out ?? 0,
          created_at: event.created_at,
        }
        const existingIndex = get().messages.findIndex((item) => item.id === message.id)
        const messages = [...get().messages]
        if (existingIndex >= 0) messages[existingIndex] = message
        else messages.push(message)
        set({
          pending,
          messages,
          unread: get().autoScroll ? get().unread : get().unread + 1,
        })
        break
      }
      case 'fs.create':
      case 'fs.write':
      case 'fs.delete':
      case 'fs.move': {
        const payload = event.payload as { path?: string }
        if (payload?.path) useFilesStore.getState().recordFileEvent(payload.path, event.type)
        break
      }
      case 'approval.request': {
        const payload = event.payload as { request?: ApprovalRequest }
        if (payload?.request) {
          const exists = get().approvals.some((item) => item.id === payload.request!.id)
          if (!exists) set({ approvals: [...get().approvals, payload.request] })
        }
        break
      }
      case 'approval.resolved': {
        const payload = event.payload as { approval_id?: string }
        if (payload?.approval_id) {
          set({ approvals: get().approvals.filter((item) => item.id !== payload.approval_id) })
        }
        break
      }
      case 'agent.status': {
        const payload = event.payload as {
          role_id?: string
          status?: AgentStatusEntry['status']
          detail?: string
        }
        if (payload?.role_id && payload.status) {
          set({
            agentStatus: {
              ...get().agentStatus,
              [payload.role_id]: { status: payload.status, detail: payload.detail, updatedAt: Date.now() },
            },
          })
        }
        break
      }
      case 'usage':
        scheduleRequestsRefresh(() => void get().refreshRequests())
        break
      case 'agent.end': {
        // If the agent failed mid-stream there will be no `agent.message` — clear its ghost delta.
        const payload = event.payload as { role_id?: string | null }
        if (payload?.role_id) {
          const pending = { ...get().pending }
          let changed = false
          for (const [id, item] of Object.entries(pending)) {
            if (item.roleId === payload.role_id) {
              delete pending[id]
              changed = true
            }
          }
          if (changed) set({ pending })
        }
        scheduleRequestsRefresh(() => void get().refreshRequests())
        break
      }
      case 'task.created':
      case 'task.updated':
      case 'task.done': {
        const payload = event.payload as {
          task_id?: string
          title?: string
          status?: Task['status']
          result?: string
          role_id?: string | null
        }
        if (payload?.task_id) {
          const exists = get().tasks.some((task) => task.id === payload.task_id)
          if (!exists && event.type === 'task.created') {
            const task: Task = {
              id: payload.task_id,
              session_id: get().sessionId ?? '',
              parent_id: null,
              assigned_role_id: payload.role_id ?? null,
              title: payload.title ?? 'Задача',
              payload: '',
              status: payload.status ?? 'pending',
              depends_on: [],
              result: payload.result ?? null,
              created_at: event.created_at,
              updated_at: event.created_at,
            }
            set({ tasks: [...get().tasks, task] })
          } else {
            const tasks = get().tasks.map((task) =>
              task.id === payload.task_id
                ? {
                    ...task,
                    status: payload.status ?? task.status,
                    result: payload.result ?? task.result,
                  }
                : task,
            )
            set({ tasks })
          }
        }
        break
      }
      case 'run.end':
        set({ pending: {} })
        void get().refreshRequests()
        break
      default:
        break
    }
  },
}))

function scheduleRequestsRefresh(fn: () => void): void {
  if (requestsTimer) window.clearTimeout(requestsTimer)
  requestsTimer = window.setTimeout(() => {
    requestsTimer = null
    fn()
  }, 1200)
}

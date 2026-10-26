import type { ApprovalRequest, SessionStatus, TaskStatus } from './types'

export type EventType =
  | 'fs.create'
  | 'fs.write'
  | 'fs.delete'
  | 'fs.move'
  | 'shell.exec'
  | 'agent.start'
  | 'agent.end'
  | 'agent.message'
  | 'agent.status'
  | 'agent.tool_call'
  | 'agent.tool_result'
  | 'task.created'
  | 'task.updated'
  | 'task.done'
  | 'run.start'
  | 'run.end'
  | 'plan.created'
  | 'approval.request'
  | 'approval.resolved'
  | 'provider.request'
  | 'usage'
  | 'error'
  | 'warn'
  | 'info'

export interface EventRecord<T = unknown> {
  id: string
  session_id: string | null
  type: EventType
  payload: T
  created_at: number
}

export interface RunStartPayload {
  session_id: string
  project_id: string
  orchestra_id: string
  strategy: string
}

export interface RunEndPayload {
  session_id: string
  status: SessionStatus
  reason?: string
  tokens_in?: number
  tokens_out?: number
}

export interface AgentStartPayload {
  session_id: string
  role_id: string
  role_name: string
  task_id?: string
  phase?: string
}

export interface AgentEndPayload {
  session_id: string
  role_id: string
  role_name: string
  task_id?: string
  ok: boolean
  tokens_in?: number
  tokens_out?: number
  error?: string
}

export interface AgentStatusPayload {
  session_id: string
  role_id: string
  status: 'idle' | 'thinking' | 'tool' | 'done' | 'error'
  detail?: string
}

export interface FsEventPayload {
  path: string
  role_id?: string | null
  role_name?: string | null
  session_id?: string | null
  old_path?: string
}

export interface ShellEventPayload {
  command: string
  cwd: string
  code: number | null
  ok: boolean
  output?: string
  role_id?: string | null
  role_name?: string | null
}

export interface TaskEventPayload {
  task_id: string
  title: string
  status: TaskStatus
  role_id?: string | null
  role_name?: string | null
}

export interface PlanEventPayload {
  round: number
  tasks: Array<{ id: string; title: string; assignee?: string | null }>
}

export interface ProviderRequestPayload {
  provider: string
  model: string
  endpoint: string
  status: number | 'error'
  latency_ms: number
  tokens_in?: number
  tokens_out?: number
  request?: string
  response_preview?: string
  error?: string
  at?: number
}

export interface UsagePayload {
  role_id?: string | null
  role_name?: string
  tokens_in: number
  tokens_out: number
  total_in: number
  total_out: number
  cost?: number
}

export interface ErrorEventPayload {
  code: string
  message: string
  role_id?: string | null
  role_name?: string
  details?: unknown
}

export interface ApprovalEventPayload {
  request: ApprovalRequest
  allowed?: boolean
}

export interface AgentMessagePayload {
  message_id: string
  role_id: string | null
  kind: string
  content: string
  tokens_in?: number
  tokens_out?: number
  to_role_id?: string | null
}

/** Envelope pushed over SSE. */
export type StreamEnvelope =
  | { channel: 'event'; event: EventRecord }
  | { channel: 'delta'; session_id: string; message_id: string; role_id: string | null; text: string }
  | { channel: 'session'; session: { id: string; status: SessionStatus; tokens_in: number; tokens_out: number; cost: number } }
  | { channel: 'tasks'; session_id: string; tasks: unknown[] }
  | { channel: 'fs'; change: { project_id: string; type: string; path: string; old_path?: string; source: string; at: number } }
  | { channel: 'hello'; session_id?: string }

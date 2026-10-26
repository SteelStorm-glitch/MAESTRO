export type ProviderProtocol = 'openai-compatible' | 'anthropic' | 'gemini'

export type RolePermission = 'read' | 'write' | 'admin'
export type ShellMode = 'off' | 'confirm' | 'auto'
export type OrchestraStrategy = 'conductor' | 'pipeline' | 'council'
export type ApprovalMode = 'auto' | 'confirm' | 'deny'
export type SessionStatus = 'idle' | 'running' | 'paused' | 'done' | 'error' | 'cancelled'
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'
export type MessageKind =
  | 'user'
  | 'plan'
  | 'task'
  | 'result'
  | 'tool_call'
  | 'tool_result'
  | 'final'
  | 'error'
  | 'system'

export interface ExtraHeader {
  k: string
  v: string
}

/** Provider as exposed to the browser — never contains the API key. */
export interface Provider {
  id: string
  name: string
  protocol: ProviderProtocol
  base_url: string
  extra_headers: ExtraHeader[]
  timeout_ms: number
  created_at: number
  /** Masked tail of the stored key, e.g. "••••a1b2". */
  key_masked: string | null
  has_key: boolean
}

export interface ProviderInput {
  name: string
  protocol: ProviderProtocol
  base_url: string
  api_key?: string | null
  extra_headers?: ExtraHeader[]
  timeout_ms?: number
}

export interface Model {
  id: string
  provider_id: string
  model_id: string
  display_name: string
  context_window: number
  max_output: number
  supports_tools: boolean
  supports_vision: boolean
  enabled: boolean
}

export interface ModelInput {
  provider_id: string
  model_id: string
  display_name?: string
  context_window?: number
  max_output?: number
  supports_tools?: boolean
  supports_vision?: boolean
  enabled?: boolean
}

export interface RemoteModel {
  id: string
  display_name?: string
  context_window?: number
}

export interface Role {
  id: string
  name: string
  description: string
  system_prompt: string
  model_id: string | null
  temperature: number
  tools: string[]
  permission: RolePermission
  shell_mode: ShellMode
  color: string
  created_at: number
}

export interface RoleInput {
  name: string
  description?: string
  system_prompt?: string
  model_id?: string | null
  temperature?: number
  tools?: string[]
  permission?: RolePermission
  shell_mode?: ShellMode
  color?: string
}

export interface Orchestra {
  id: string
  name: string
  strategy: OrchestraStrategy
  conductor_role_id: string | null
  verifier_role_id: string | null
  fixer_role_id: string | null
  max_rounds: number
  budget_tokens: number
  approval_mode: ApprovalMode
  config_json: Record<string, unknown>
  created_at: number
  members: OrchestraMember[]
}

export interface OrchestraMember {
  orchestra_id?: string
  role_id: string
  position: number
}

export interface OrchestraInput {
  name: string
  strategy?: OrchestraStrategy
  conductor_role_id?: string | null
  verifier_role_id?: string | null
  fixer_role_id?: string | null
  max_rounds?: number
  budget_tokens?: number
  approval_mode?: ApprovalMode
  config_json?: Record<string, unknown>
  members?: Array<{ role_id: string; position: number }>
}

export interface ValidationIssue {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidateResult {
  ok: boolean
  issues: ValidationIssue[]
}

export interface Project {
  id: string
  name: string
  root_path: string
  created_at: number
}

export interface Session {
  id: string
  project_id: string
  orchestra_id: string
  title: string
  status: SessionStatus
  tokens_in: number
  tokens_out: number
  cost: number
  created_at: number
  updated_at: number
}

export interface Message {
  id: string
  session_id: string
  role_id: string | null
  kind: MessageKind
  to_role_id: string | null
  content: string
  tokens_in: number
  tokens_out: number
  created_at: number
}

export interface Task {
  id: string
  session_id: string
  parent_id: string | null
  assigned_role_id: string | null
  title: string
  payload: string
  status: TaskStatus
  depends_on: string[]
  result: string | null
  created_at: number
  updated_at: number
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: TreeNode[]
  hidden?: boolean
}

export interface FilePreview {
  path: string
  size: number
  binary: boolean
  truncated: boolean
  content: string
}

export interface FsChange {
  project_id: string
  type: 'create' | 'write' | 'delete' | 'move'
  path: string
  old_path?: string
  source: 'agent' | 'user' | 'external'
  at: number
}

export interface ApprovalRequest {
  id: string
  session_id: string
  role_id: string | null
  role_name: string
  tool: string
  args: Record<string, unknown>
  created_at: number
}

export interface SessionDetail extends Session {
  project: Project
  orchestra: Orchestra | null
  /** Shell approvals still waiting for the user in the active run. */
  approvals?: ApprovalRequest[]
}

export const DEFAULT_COLORS = [
  '#8B8BF5',
  '#5AC8FA',
  '#46A758',
  '#FFB224',
  '#E5484D',
  '#F76B15',
  '#A78BFA',
  '#2DD4BF',
] as const

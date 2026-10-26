import type {
  EventRecord,
  FilePreview,
  Model,
  ModelInput,
  Orchestra,
  OrchestraInput,
  Project,
  Provider,
  ProviderInput,
  RemoteModel,
  Role,
  RoleInput,
  Session,
  SessionDetail,
  Task,
  TreeNode,
  ValidateResult,
  Message,
  ExtraHeader,
} from '@maestro/shared'

export class ApiError extends Error {
  code: string
  status: number
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body) headers['content-type'] = 'application/json'
  const token = localStorage.getItem('maestro_token')
  if (token) headers['x-maestro-token'] = token
  let response: Response
  try {
    response = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } })
  } catch {
    throw new ApiError(0, 'network', 'Сервер недоступен. Проверьте, что он запущен.')
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })?.error
    throw new ApiError(
      response.status,
      error?.code ?? 'http_error',
      error?.message ?? `Ошибка запроса (${response.status})`,
      error?.details,
    )
  }
  return payload as T
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const patch = (body: unknown): RequestInit => ({ method: 'PATCH', body: JSON.stringify(body) })

export interface BrowseResult {
  path: string
  parent: string | null
  separator: string
  dirs: Array<{ name: string; path: string }>
  drives: string[]
}

export const api = {
  health: () => request<{ status: string; version: string }>('/api/health'),

  providers: {
    list: () => request<Provider[]>('/api/providers'),
    create: (input: ProviderInput) => request<Provider>('/api/providers', json(input)),
    update: (id: string, input: Partial<ProviderInput>) => request<Provider>(`/api/providers/${id}`, patch(input)),
    remove: (id: string) => request<void>(`/api/providers/${id}`, { method: 'DELETE' }),
    test: (id: string) =>
      request<{ ok: boolean; error?: string; latencyMs: number }>(`/api/providers/${id}/test`, { method: 'POST' }),
    remoteModels: (id: string) => request<RemoteModel[]>(`/api/providers/${id}/models-remote`),
    importModels: (id: string, models: RemoteModel[]) =>
      request<Model[]>(`/api/providers/${id}/models-import`, json({ models })),
    exportAll: () => request<Record<string, unknown>>('/api/providers/export'),
    importAll: (data: unknown) => request<{ imported: number }>('/api/providers/import', json(data)),
  },

  models: {
    list: (providerId?: string) =>
      request<Model[]>(`/api/models${providerId ? `?provider=${encodeURIComponent(providerId)}` : ''}`),
    create: (input: Partial<ModelInput> & { provider_id: string; model_id: string }) =>
      request<Model>('/api/models', json(input)),
    update: (id: string, input: Partial<ModelInput>) => request<Model>(`/api/models/${id}`, patch(input)),
    remove: (id: string) => request<void>(`/api/models/${id}`, { method: 'DELETE' }),
  },

  roles: {
    list: () => request<Role[]>('/api/roles'),
    create: (input: RoleInput) => request<Role>('/api/roles', json(input)),
    update: (id: string, input: Partial<RoleInput>) => request<Role>(`/api/roles/${id}`, patch(input)),
    remove: (id: string) => request<void>(`/api/roles/${id}`, { method: 'DELETE' }),
  },

  orchestras: {
    list: () => request<Orchestra[]>('/api/orchestras'),
    get: (id: string) => request<Orchestra>(`/api/orchestras/${id}`),
    create: (input: OrchestraInput) => request<Orchestra>('/api/orchestras', json(input)),
    update: (id: string, input: Partial<OrchestraInput>) => request<Orchestra>(`/api/orchestras/${id}`, patch(input)),
    remove: (id: string) => request<void>(`/api/orchestras/${id}`, { method: 'DELETE' }),
    validate: (id: string) => request<ValidateResult>(`/api/orchestras/${id}/validate`, { method: 'POST' }),
    exportOne: (id: string) => request<Record<string, unknown>>(`/api/orchestras/${id}/export`),
    importOne: (data: unknown) =>
      request<{ orchestra: Orchestra; warnings: string[] }>('/api/orchestras/import', json(data)),
  },

  projects: {
    list: () => request<Project[]>('/api/projects'),
    create: (input: { name?: string; root_path: string }) => request<Project>('/api/projects', json(input)),
    remove: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  },

  fs: {
    tree: (projectId: string, hidden = false, gitignore = false) =>
      request<{ root: string; nodes: TreeNode[] }>(
        `/api/fs/tree?project=${encodeURIComponent(projectId)}&hidden=${hidden ? '1' : '0'}&gitignore=${
          gitignore ? '1' : '0'
        }`,
      ),
    file: (projectId: string, path: string) =>
      request<FilePreview>(
        `/api/fs/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
      ),
    create: (projectId: string, path: string, type: 'file' | 'dir', content = '') =>
      request<{ ok: boolean }>('/api/fs/create', json({ project: projectId, path, type, content })),
    rename: (projectId: string, from: string, to: string) =>
      request<{ ok: boolean }>('/api/fs/rename', json({ project: projectId, from, to })),
    remove: (projectId: string, path: string) =>
      request<{ ok: boolean }>('/api/fs/delete', json({ project: projectId, path })),
    browse: (path?: string) =>
      request<BrowseResult>(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  },

  sessions: {
    list: (projectId?: string) =>
      request<Session[]>(`/api/sessions${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`),
    create: (input: { project_id: string; orchestra_id: string; input: string }) =>
      request<Session>('/api/sessions', json(input)),
    get: (id: string) => request<SessionDetail>(`/api/sessions/${id}`),
    messages: (id: string) => request<Message[]>(`/api/sessions/${id}/messages`),
    tasks: (id: string) => request<Task[]>(`/api/sessions/${id}/tasks`),
    message: (id: string, content: string, toRoleId?: string | null) =>
      request<{ queued: boolean; started?: boolean }>(
        `/api/sessions/${id}/message`,
        json({ content, to_role_id: toRoleId ?? null }),
      ),
    cancel: (id: string) => request<{ cancelled: boolean }>(`/api/sessions/${id}/cancel`, { method: 'POST' }),
    pause: (id: string) => request<{ paused: boolean }>(`/api/sessions/${id}/pause`, { method: 'POST' }),
    resume: (id: string) => request<{ resumed: boolean }>(`/api/sessions/${id}/resume`, { method: 'POST' }),
    approve: (id: string, approvalId: string, allow: boolean) =>
      request<{ ok: boolean }>(`/api/sessions/${id}/approve`, json({ approval_id: approvalId, allow })),
    remove: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  },

  events: (filters: { session?: string; types?: string; limit?: number; q?: string } = {}) => {
    const params = new URLSearchParams()
    if (filters.session) params.set('session', filters.session)
    if (filters.types) params.set('types', filters.types)
    if (filters.limit) params.set('limit', String(filters.limit))
    if (filters.q) params.set('q', filters.q)
    return request<EventRecord[]>(`/api/events?${params.toString()}`)
  },
}

export type { ExtraHeader }

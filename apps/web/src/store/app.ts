import { create } from 'zustand'
import type {
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
  ValidateResult,
} from '@maestro/shared'
import { api, ApiError } from '../api/client'

export type SidebarTab = 'files' | 'orchestras' | 'roles' | 'providers'
export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface AppState {
  booted: boolean
  serverOnline: boolean
  busy: boolean
  projects: Project[]
  providers: Provider[]
  models: Model[]
  roles: Role[]
  orchestras: Orchestra[]
  sessions: Session[]
  projectId: string | null
  orchestraId: string | null
  sessionId: string | null
  tab: SidebarTab
  hideGitignored: boolean
  toasts: Toast[]
  roleDraftId: string | null
  orchestraDraftId: string | null
  sessionHistoryOpen: boolean
  projectDialogOpen: boolean
  providerHealth: Record<string, { ok: boolean; error?: string; latencyMs: number; at: number }>

  bootstrap: () => Promise<void>
  refreshProjects: () => Promise<void>
  refreshProviders: () => Promise<void>
  refreshModels: () => Promise<void>
  refreshRoles: () => Promise<void>
  refreshOrchestras: () => Promise<void>
  refreshSessions: () => Promise<void>
  refreshAll: () => Promise<void>

  selectProject: (id: string | null) => void
  selectOrchestra: (id: string | null) => void
  selectSession: (id: string | null) => void
  setTab: (tab: SidebarTab) => void
  setHideGitignored: (value: boolean) => void
  setSessionHistoryOpen: (open: boolean) => void
  setProjectDialogOpen: (open: boolean) => void
  openRoleEditor: (id: string | null) => void
  openOrchestraBuilder: (id: string | null) => void

  notify: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
  handleError: (error: unknown) => void

  createProject: (rootPath: string, name?: string) => Promise<Project>
  deleteProject: (id: string) => Promise<void>

  saveProvider: (input: ProviderInput, id?: string) => Promise<Provider>
  deleteProvider: (id: string) => Promise<void>
  testProvider: (id: string) => Promise<{ ok: boolean; error?: string; latencyMs: number }>
  fetchRemoteModels: (id: string) => Promise<RemoteModel[]>
  importRemoteModels: (id: string, models: RemoteModel[]) => Promise<void>

  saveModel: (input: ModelInput, id?: string) => Promise<Model>
  deleteModel: (id: string) => Promise<void>

  saveRole: (input: RoleInput, id?: string) => Promise<Role>
  deleteRole: (id: string) => Promise<void>

  saveOrchestra: (input: OrchestraInput, id?: string) => Promise<Orchestra>
  deleteOrchestra: (id: string) => Promise<void>
  validateOrchestra: (id: string) => Promise<ValidateResult>
  exportOrchestra: (id: string) => Promise<Record<string, unknown>>
  importOrchestra: (data: unknown) => Promise<Orchestra>

  startSession: (input: string) => Promise<Session | null>
  newSession: () => void
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

let toastCounter = 1

export const useAppStore = create<AppState>()((set, get) => ({
  booted: false,
  serverOnline: false,
  busy: false,
  projects: [],
  providers: [],
  models: [],
  roles: [],
  orchestras: [],
  sessions: [],
  projectId: storageGet('maestro_project'),
  orchestraId: storageGet('maestro_orchestra'),
  sessionId: storageGet('maestro_session'),
  tab: 'files',
  hideGitignored: false,
  toasts: [],
  roleDraftId: null,
  orchestraDraftId: null,
  sessionHistoryOpen: false,
  projectDialogOpen: false,
  providerHealth: {},

  bootstrap: async () => {
    try {
      await api.health()
      const [projects, providers, models, roles, orchestras, sessions] = await Promise.all([
        api.projects.list(),
        api.providers.list(),
        api.models.list(),
        api.roles.list(),
        api.orchestras.list(),
        api.sessions.list(),
      ])
      const savedProject = get().projectId
      const projectId = projects.some((p) => p.id === savedProject) ? savedProject : (projects[0]?.id ?? null)
      const savedOrchestra = get().orchestraId
      const orchestraId = orchestras.some((o) => o.id === savedOrchestra)
        ? savedOrchestra
        : (orchestras[0]?.id ?? null)
      const savedSession = get().sessionId
      const sessionId = sessions.some((s) => s.id === savedSession) ? savedSession : null
      storageSet('maestro_project', projectId)
      storageSet('maestro_orchestra', orchestraId)
      storageSet('maestro_session', sessionId)
      set({
        projects,
        providers,
        models,
        roles,
        orchestras,
        sessions,
        projectId,
        orchestraId,
        sessionId,
        serverOnline: true,
        booted: true,
      })
    } catch (error) {
      set({ booted: true, serverOnline: false })
      get().handleError(error)
    }
  },

  refreshProjects: async () => set({ projects: await api.projects.list() }),
  refreshProviders: async () => set({ providers: await api.providers.list() }),
  refreshModels: async () => set({ models: await api.models.list() }),
  refreshRoles: async () => set({ roles: await api.roles.list() }),
  refreshOrchestras: async () => set({ orchestras: await api.orchestras.list() }),
  refreshSessions: async () => set({ sessions: await api.sessions.list() }),

  refreshAll: async () => {
    const [providers, models, roles, orchestras, sessions, projects] = await Promise.all([
      api.providers.list(),
      api.models.list(),
      api.roles.list(),
      api.orchestras.list(),
      api.sessions.list(),
      api.projects.list(),
    ])
    set({ providers, models, roles, orchestras, sessions, projects })
  },

  selectProject: (id) => {
    storageSet('maestro_project', id)
    set({ projectId: id, sessionId: null })
    storageSet('maestro_session', null)
  },

  selectOrchestra: (id) => {
    storageSet('maestro_orchestra', id)
    set({ orchestraId: id })
  },

  selectSession: (id) => {
    storageSet('maestro_session', id)
    set({ sessionId: id })
  },

  setTab: (tab) => set({ tab }),
  setHideGitignored: (value) => set({ hideGitignored: value }),
  setSessionHistoryOpen: (open) => set({ sessionHistoryOpen: open }),
  setProjectDialogOpen: (open) => set({ projectDialogOpen: open }),
  openRoleEditor: (id) => set({ roleDraftId: id }),
  openOrchestraBuilder: (id) => set({ orchestraDraftId: id }),

  notify: (message, kind = 'info') => {
    const toast: Toast = { id: toastCounter++, kind, message }
    set({ toasts: [...get().toasts, toast] })
    window.setTimeout(() => get().dismissToast(toast.id), 5000)
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),

  handleError: (error) => {
    let message =
      error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Неизвестная ошибка'
    if (error instanceof ApiError && Array.isArray(error.details)) {
      const issues = error.details
        .map((item) => (item && typeof item === 'object' ? String((item as { message?: string }).message ?? '') : ''))
        .filter(Boolean)
      if (issues.length > 0) message = `${message}: ${issues.slice(0, 3).join('; ')}`
    }
    get().notify(message, 'error')
  },

  createProject: async (rootPath, name) => {
    const project = await api.projects.create({ root_path: rootPath, name })
    await get().refreshProjects()
    get().selectProject(project.id)
    get().notify(`Проект «${project.name}» подключён`, 'success')
    return project
  },

  deleteProject: async (id) => {
    await api.projects.remove(id)
    await get().refreshProjects()
    if (get().projectId === id) get().selectProject(get().projects[0]?.id ?? null)
  },

  saveProvider: async (input, id) => {
    const provider = id ? await api.providers.update(id, input) : await api.providers.create(input)
    await get().refreshProviders()
    await get().refreshModels()
    return provider
  },

  deleteProvider: async (id) => {
    await api.providers.remove(id)
    await get().refreshAll()
  },

  testProvider: async (id) => {
    const result = await api.providers.test(id)
    set({
      providerHealth: {
        ...get().providerHealth,
        [id]: { ok: result.ok, error: result.error, latencyMs: result.latencyMs, at: Date.now() },
      },
    })
    return result
  },

  fetchRemoteModels: async (id) => api.providers.remoteModels(id),

  importRemoteModels: async (id, models) => {
    await api.providers.importModels(id, models)
    await get().refreshModels()
  },

  saveModel: async (input, id) => {
    const model = id ? await api.models.update(id, input) : await api.models.create(input as never)
    await get().refreshModels()
    return model
  },

  deleteModel: async (id) => {
    await api.models.remove(id)
    await get().refreshModels()
    await get().refreshRoles()
  },

  saveRole: async (input, id) => {
    const role = id ? await api.roles.update(id, input) : await api.roles.create(input)
    await get().refreshRoles()
    await get().refreshOrchestras()
    return role
  },

  deleteRole: async (id) => {
    await api.roles.remove(id)
    await get().refreshRoles()
    await get().refreshOrchestras()
  },

  saveOrchestra: async (input, id) => {
    const orchestra = id ? await api.orchestras.update(id, input) : await api.orchestras.create(input)
    await get().refreshOrchestras()
    if (!get().orchestraId) get().selectOrchestra(orchestra.id)
    return orchestra
  },

  deleteOrchestra: async (id) => {
    await api.orchestras.remove(id)
    await get().refreshOrchestras()
    if (get().orchestraId === id) get().selectOrchestra(get().orchestras[0]?.id ?? null)
  },

  validateOrchestra: async (id) => api.orchestras.validate(id),
  exportOrchestra: async (id) => api.orchestras.exportOne(id),

  importOrchestra: async (data) => {
    const result = await api.orchestras.importOne(data)
    await get().refreshAll()
    get().selectOrchestra(result.orchestra.id)
    if (result.warnings.length > 0) get().notify(result.warnings.join('\n'), 'info')
    return result.orchestra
  },

  startSession: async (input) => {
    const { projectId, orchestraId } = get()
    if (!projectId) {
      get().notify('Сначала выберите папку проекта', 'error')
      return null
    }
    if (!orchestraId) {
      get().notify('Сначала создайте или выберите оркестр', 'error')
      return null
    }
    const session = await api.sessions.create({ project_id: projectId, orchestra_id: orchestraId, input })
    set({ sessions: [session, ...get().sessions] })
    get().selectSession(session.id)
    return session
  },

  newSession: () => {
    set({ sessionId: null })
    storageSet('maestro_session', null)
  },
}))

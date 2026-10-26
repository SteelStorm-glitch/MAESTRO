import { create } from 'zustand'
import type { FilePreview, TreeNode } from '@maestro/shared'
import { api } from '../api/client'
import { openFsStream } from '../api/sse'

export type TouchKind = 'created' | 'modified' | 'deleted'

interface FilesState {
  projectId: string | null
  root: string
  nodes: TreeNode[]
  loading: boolean
  hideHidden: boolean
  hideGitignored: boolean
  expanded: Record<string, boolean>
  touched: Record<string, TouchKind>
  flashing: Record<string, number>
  preview: FilePreview | null
  previewOpen: boolean
  previewLoading: boolean
  error: string | null

  load: (projectId: string, hideHidden?: boolean, hideGitignored?: boolean) => Promise<void>
  refresh: () => Promise<void>
  setHideHidden: (value: boolean) => void
  setHideGitignored: (value: boolean) => void
  toggle: (path: string) => void
  expandAll: () => void
  collapseAll: () => void
  openPreview: (path: string) => Promise<void>
  closePreview: () => void
  recordFileEvent: (path: string, type: string) => void
  setHistory: (markers: Record<string, TouchKind>) => void
  flash: (path: string) => void
  createEntry: (path: string, type: 'file' | 'dir') => Promise<void>
  renameEntry: (from: string, to: string) => Promise<void>
  deleteEntry: (path: string) => Promise<void>
  watch: (projectId: string) => () => void
}

let refreshTimer: number | null = null
let watchCleanup: (() => void) | null = null

export const useFilesStore = create<FilesState>()((set, get) => ({
  projectId: null,
  root: '',
  nodes: [],
  loading: false,
  hideHidden: false,
  hideGitignored: false,
  expanded: {},
  touched: {},
  flashing: {},
  preview: null,
  previewOpen: false,
  previewLoading: false,
  error: null,

  load: async (projectId, hideHidden, hideGitignored) => {
    set({ loading: true, projectId })
    try {
      const response = await api.fs.tree(
        projectId,
        hideHidden ?? get().hideHidden,
        hideGitignored ?? get().hideGitignored,
      )
      const expanded = { ...get().expanded }
      if (Object.keys(expanded).length === 0) {
        const walk = (nodes: TreeNode[], depth: number) => {
          if (depth > 1) return
          for (const node of nodes) {
            if (node.type === 'dir') {
              expanded[node.path] = true
              if (node.children) walk(node.children, depth + 1)
            }
          }
        }
        walk(response.nodes, 0)
      }
      set({ nodes: response.nodes, root: response.root, loading: false, error: null, expanded })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  },

  refresh: async () => {
    const { projectId, hideHidden, hideGitignored } = get()
    if (!projectId) return
    try {
      const response = await api.fs.tree(projectId, hideHidden, hideGitignored)
      set({ nodes: response.nodes, root: response.root })
    } catch {
      /* transient */
    }
  },

  setHideHidden: (value) => {
    set({ hideHidden: value })
    const projectId = get().projectId
    if (projectId) void get().load(projectId, value, get().hideGitignored)
  },

  setHideGitignored: (value) => {
    set({ hideGitignored: value })
    const projectId = get().projectId
    if (projectId) void get().load(projectId, get().hideHidden, value)
  },

  toggle: (path) => set({ expanded: { ...get().expanded, [path]: !get().expanded[path] } }),

  expandAll: () => {
    const expanded: Record<string, boolean> = {}
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'dir') {
          expanded[node.path] = true
          if (node.children) walk(node.children)
        }
      }
    }
    walk(get().nodes)
    set({ expanded })
  },

  collapseAll: () => set({ expanded: {} }),

  openPreview: async (path) => {
    const projectId = get().projectId
    if (!projectId) return
    set({ previewOpen: true, previewLoading: true })
    try {
      const preview = await api.fs.file(projectId, path)
      set({ preview, previewLoading: false })
    } catch (error) {
      set({ previewLoading: false, preview: null, error: error instanceof Error ? error.message : String(error) })
    }
  },

  closePreview: () => set({ previewOpen: false, preview: null }),

  recordFileEvent: (path, type) => {
    const kind: TouchKind = type === 'fs.create' ? 'created' : type === 'fs.delete' ? 'deleted' : 'modified'
    set({ touched: { ...get().touched, [path]: kind } })
    get().flash(path)
    scheduleRefresh(() => void get().refresh())
  },

  setHistory: (markers) => set({ touched: markers }),

  flash: (path) => {
    const stamp = Date.now()
    set({ flashing: { ...get().flashing, [path]: stamp } })
    window.setTimeout(() => {
      if (get().flashing[path] === stamp) {
        const next = { ...get().flashing }
        delete next[path]
        set({ flashing: next })
      }
    }, 1600)
  },

  createEntry: async (path, type) => {
    const projectId = get().projectId
    if (!projectId) return
    await api.fs.create(projectId, path, type)
    await get().refresh()
  },

  renameEntry: async (from, to) => {
    const projectId = get().projectId
    if (!projectId) return
    await api.fs.rename(projectId, from, to)
    await get().refresh()
  },

  deleteEntry: async (path) => {
    const projectId = get().projectId
    if (!projectId) return
    await api.fs.remove(projectId, path)
    await get().refresh()
  },

  watch: (projectId) => {
    watchCleanup?.()
    watchCleanup = openFsStream(projectId, (change) => {
      const data = change as { channel?: string; change?: { path?: string; type?: string; source?: string } }
      if (data.channel === 'hello') {
        void get().refresh()
        return
      }
      if (data.channel !== 'fs' || !data.change?.path) return
      if (data.change.source === 'agent') get().flash(data.change.path)
      scheduleRefresh(() => void get().refresh())
    })
    return () => {
      watchCleanup?.()
      watchCleanup = null
    }
  },
}))

function scheduleRefresh(fn: () => void): void {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null
    fn()
  }, 180)
}

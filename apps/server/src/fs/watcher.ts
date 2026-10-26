import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FsChange } from '@maestro/shared'
import { bus } from '../events/bus'
import { getProject } from '../db/repo/projects'
import { logger } from '../lib/logger'

const IGNORE_RE = /(^|[\\/])(\.git|node_modules|\.maestro_trash|dist|build|target|__pycache__|\.venv|venv)([\\/]|$)/

class WatcherManager {
  private watchers = new Map<string, FSWatcher>()
  private recentAgentChanges = new Map<string, number>()
  private pending = new Map<string, FsChange>()
  private flushTimer: NodeJS.Timeout | null = null
  private subscribed = false

  private subscribeBus(): void {
    if (this.subscribed) return
    this.subscribed = true
    bus.subscribe((envelope) => {
      if (envelope.channel !== 'event') return
      const { type, payload } = envelope.event
      if (!type.startsWith('fs.')) return
      const data = payload as { path?: string }
      if (!data.path) return
      this.recentAgentChanges.set(data.path, Date.now())
      if (this.recentAgentChanges.size > 500) {
        const cutoff = Date.now() - 10_000
        for (const [key, at] of this.recentAgentChanges) if (at < cutoff) this.recentAgentChanges.delete(key)
      }
    })
  }

  ensure(projectId: string): void {
    if (this.watchers.has(projectId)) return
    const project = getProject(projectId)
    if (!project) return
    this.subscribeBus()

    const watcher = chokidar.watch(project.root_path, {
      ignoreInitial: true,
      persistent: true,
      depth: 20,
      ignored: (candidate: string, stats?: { isDirectory(): boolean }) => {
        if (IGNORE_RE.test(candidate)) return true
        if (stats?.isDirectory() && path.basename(candidate).startsWith('.') && path.basename(candidate) !== '.env') {
          return false
        }
        return false
      },
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    })

    const push = (changeType: FsChange['type'], absolute: string, oldPath?: string) => {
      const rel = path.relative(project.root_path, absolute).split(path.sep).join('/')
      if (!rel || rel.startsWith('..')) return
      const recent = this.recentAgentChanges.get(rel)
      const source: FsChange['source'] = recent && Date.now() - recent < 4000 ? 'agent' : 'external'
      const key = `${changeType}:${rel}`
      const change: FsChange = {
        project_id: projectId,
        type: changeType,
        path: rel,
        source,
        at: Date.now(),
      }
      if (oldPath) change.old_path = path.relative(project.root_path, oldPath).split(path.sep).join('/')
      this.pending.set(key, change)
      this.scheduleFlush()
    }

    watcher.on('add', (file) => push('create', file))
    watcher.on('change', (file) => push('write', file))
    watcher.on('unlink', (file) => push('delete', file))
    watcher.on('addDir', (dir) => push('create', dir))
    watcher.on('unlinkDir', (dir) => push('delete', dir))
    watcher.on('error', (error) => logger.warn('Watcher error', { projectId, error: String(error) }))

    this.watchers.set(projectId, watcher)
    logger.info(`Watching ${project.root_path}`)
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      const changes = [...this.pending.values()]
      this.pending.clear()
      for (const change of changes) bus.fsChange(change)
    }, 150)
  }

  stop(projectId: string): void {
    const watcher = this.watchers.get(projectId)
    if (watcher) void watcher.close()
    this.watchers.delete(projectId)
  }

  closeAll(): void {
    for (const watcher of this.watchers.values()) void watcher.close()
    this.watchers.clear()
  }
}

export const watchers = new WatcherManager()

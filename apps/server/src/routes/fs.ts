import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getProject } from '../db/repo/projects'
import { buildTree, previewFile } from '../tools/fs'
import { resolveProjectPath, projectRelative } from '../tools/guard'
import { watchers } from '../fs/watcher'
import { bus } from '../events/bus'
import { badRequest, notFound, toHttpError } from '../http/errors'

function requireProject(id: string | undefined) {
  if (!id) throw badRequest('Укажите project')
  const project = getProject(id)
  if (!project) throw notFound('Проект не найден')
  return project
}

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', '.maestro_trash'])

export async function fsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { project?: string; depth?: string; hidden?: string; gitignore?: string } }>(
    '/api/fs/tree',
    async (request) => {
      const project = requireProject(request.query.project)
      const depth = Math.max(0, Math.min(Number(request.query.depth ?? 6) || 6, 12))
      const hidden = request.query.hidden === '1' || request.query.hidden === 'true'
      const gitignore = request.query.gitignore === '1' || request.query.gitignore === 'true'
      watchers.ensure(project.id)
      return {
        project_id: project.id,
        root: project.root_path,
        nodes: buildTree(project.root_path, depth, hidden, gitignore),
      }
    },
  )

  app.get<{ Querystring: { project?: string; path?: string } }>('/api/fs/file', async (request) => {
    const project = requireProject(request.query.project)
    const rel = String(request.query.path ?? '')
    if (!rel) throw badRequest('Укажите path')
    try {
      return previewFile(project.root_path, rel)
    } catch (error) {
      throw toHttpError(error)
    }
  })

  app.post('/api/fs/create', async (request, reply) => {
    const body = (request.body ?? {}) as { project?: string; path?: string; type?: string; content?: string }
    const project = requireProject(body.project)
    const rel = String(body.path ?? '').trim()
    if (!rel) throw badRequest('Укажите path')
    const absolute = resolveProjectPath(project.root_path, rel)
    if (body.type === 'dir') {
      fs.mkdirSync(absolute, { recursive: true })
    } else {
      if (fs.existsSync(absolute)) throw badRequest('Файл уже существует')
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, body.content ?? '', 'utf8')
    }
    reply.code(201)
    return { ok: true, path: rel, type: body.type === 'dir' ? 'dir' : 'file' }
  })

  app.post('/api/fs/rename', async (request) => {
    const body = (request.body ?? {}) as { project?: string; from?: string; to?: string }
    const project = requireProject(body.project)
    const from = String(body.from ?? '')
    const to = String(body.to ?? '')
    if (!from || !to) throw badRequest('Укажите from и to')
    const source = resolveProjectPath(project.root_path, from)
    const target = resolveProjectPath(project.root_path, to)
    if (!fs.existsSync(source)) throw notFound('Исходный файл не найден')
    if (fs.existsSync(target)) throw badRequest('Целевой путь уже существует')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(source, target)
    return { ok: true, from, to }
  })

  app.post('/api/fs/delete', async (request) => {
    const body = (request.body ?? {}) as { project?: string; path?: string }
    const project = requireProject(body.project)
    const rel = String(body.path ?? '')
    if (!rel) throw badRequest('Укажите path')
    const absolute = resolveProjectPath(project.root_path, rel)
    if (projectRelative(project.root_path, absolute) === '.') throw badRequest('Нельзя удалить корень проекта')
    const trash = path.join(project.root_path, '.maestro_trash')
    if (path.resolve(absolute) === path.resolve(trash)) throw badRequest('Нельзя удалить корзину проекта')
    try {
      fs.lstatSync(absolute)
    } catch {
      throw notFound('Файл не найден')
    }
    fs.mkdirSync(trash, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let target = path.join(trash, `${stamp}_${path.basename(absolute)}`)
    let counter = 1
    while (fs.existsSync(target)) target = path.join(trash, `${stamp}_${counter++}_${path.basename(absolute)}`)
    fs.renameSync(absolute, target)
    return { ok: true, path: rel }
  })

  /** Directory picker used when creating a project. */
  app.get<{ Querystring: { path?: string } }>('/api/fs/browse', async (request) => {
    const requested = request.query.path?.trim() || os.homedir()
    let absolute: string
    try {
      absolute = path.resolve(requested)
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) throw new Error('not a directory')
    } catch {
      absolute = os.homedir()
    }
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true })
    } catch {
      entries = []
    }
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !DEFAULT_IGNORES.has(entry.name) && !entry.name.startsWith('$'))
      .map((entry) => ({ name: entry.name, path: path.join(absolute, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = path.dirname(absolute)
    return {
      path: absolute,
      parent: parent === absolute ? null : parent,
      separator: path.sep,
      dirs,
      drives: process.platform === 'win32' ? listWindowsDrives() : [],
    }
  })

  // SSE: live file-system changes for the tree.
  app.get<{ Querystring: { project?: string } }>('/api/fs/watch', (request: FastifyRequest<{ Querystring: { project?: string } }>, reply: FastifyReply) => {
    const project = requireProject(request.query.project)
    watchers.ensure(project.id)
    openSse(reply)
    reply.raw.write(`data: ${JSON.stringify({ channel: 'hello', project_id: project.id })}\n\n`)
    const unsubscribe = bus.subscribe((envelope) => {
      if (envelope.channel !== 'fs') return
      if (envelope.change.project_id !== project.id) return
      writeSse(reply, envelope)
    })
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n')
      } catch {
        /* closed */
      }
    }, 15000)
    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}

function listWindowsDrives(): string[] {
  const drives: string[] = []
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i)
    if (fs.existsSync(`${letter}:\\`)) drives.push(`${letter}:\\`)
  }
  return drives
}

export function openSse(reply: FastifyReply): void {
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  reply.raw.write(': connected\n\n')
}

export function writeSse(reply: FastifyReply, payload: unknown): void {
  try {
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
  } catch {
    /* client gone */
  }
}

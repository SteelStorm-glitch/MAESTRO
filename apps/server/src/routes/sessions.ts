import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getProject } from '../db/repo/projects'
import { getOrchestra } from '../db/repo/orchestras'
import { listRoles } from '../db/repo/roles'
import { createSession, deleteSession, getSession, listSessions } from '../db/repo/sessions'
import { createMessage, listMessages } from '../db/repo/messages'
import { listTasks } from '../db/repo/tasks'
import { listEvents } from '../db/repo/events'
import { getRole } from '../db/repo/roles'
import { validateOrchestra } from '../orchestra/validate'
import {
  activeRun,
  approveRun,
  cancelRun,
  enqueueUserMessage,
  pauseRun,
  resumeRun,
  startRun,
} from '../orchestra/engine'
import { bus } from '../events/bus'
import { badRequest, notFound, conflict } from '../http/errors'
import { openSse, writeSse } from './fs'

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { project?: string } }>('/api/sessions', async (request) => {
    return listSessions(request.query.project)
  })

  app.post('/api/sessions', async (request, reply) => {
    const body = (request.body ?? {}) as { project_id?: string; orchestra_id?: string; input?: string }
    const projectId = String(body.project_id ?? '')
    const orchestraId = String(body.orchestra_id ?? '')
    const input = String(body.input ?? '').trim()
    if (!input) throw badRequest('Введите задачу')
    if (!getProject(projectId)) throw badRequest('Проект не найден')
    const orchestra = getOrchestra(orchestraId)
    if (!orchestra) throw badRequest('Оркестр не найден')
    const validation = validateOrchestra(orchestra, listRoles())
    if (!validation.ok) {
      throw badRequest('Оркестр не прошёл валидацию', validation.issues)
    }

    const session = createSession({
      project_id: projectId,
      orchestra_id: orchestraId,
      title: input.replace(/\s+/g, ' ').slice(0, 70),
    })
    startRun(session.id, input)
    reply.code(201)
    return session
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request) => {
    const session = getSession(request.params.id)
    if (!session) throw notFound('Сессия не найдена')
    const project = getProject(session.project_id)
    const orchestra = getOrchestra(session.orchestra_id)
    const run = activeRun(session.id)
    return { ...session, project, orchestra, approvals: run?.pendingApprovalList() ?? [] }
  })

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    const run = activeRun(request.params.id)
    if (run) await run.stop()
    deleteSession(request.params.id)
    reply.code(204)
    return null
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id/messages', async (request) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    return listMessages(request.params.id)
  })

  app.get<{ Params: { id: string } }>('/api/sessions/:id/tasks', async (request) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    return listTasks(request.params.id)
  })

  app.post<{ Params: { id: string } }>('/api/sessions/:id/message', async (request) => {
    const session = getSession(request.params.id)
    if (!session) throw notFound('Сессия не найдена')
    const body = (request.body ?? {}) as { content?: string; text?: string; to_role_id?: string }
    const content = String(body.content ?? body.text ?? '').trim()
    if (!content) throw badRequest('Пустое сообщение')
    const toRoleId = body.to_role_id ? String(body.to_role_id) : null

    const run = activeRun(session.id)
    if (run && !run.isFinished) {
      const message = createMessage({
        session_id: session.id,
        kind: 'user',
        to_role_id: toRoleId,
        content,
      })
      bus.emit(session.id, 'agent.message', {
        message_id: message.id,
        role_id: null,
        kind: 'user',
        content,
        to_role_id: toRoleId,
      })
      enqueueUserMessage(session.id, content, toRoleId)
      return { queued: true, message_id: message.id, to: toRoleId ? getRole(toRoleId)?.name ?? null : null }
    }

    if (session.status === 'paused' || session.status === 'running') {
      throw conflict('Сессия выполняется, но движок недоступен — перезапустите её')
    }
    startRun(session.id, content)
    return { queued: false, started: true }
  })

  app.post<{ Params: { id: string } }>('/api/sessions/:id/cancel', async (request) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    return { cancelled: cancelRun(request.params.id) }
  })

  app.post<{ Params: { id: string } }>('/api/sessions/:id/pause', async (request) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    return { paused: pauseRun(request.params.id) }
  })

  app.post<{ Params: { id: string } }>('/api/sessions/:id/resume', async (request) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    return { resumed: resumeRun(request.params.id) }
  })

  app.post<{ Params: { id: string } }>('/api/sessions/:id/approve', async (request) => {
    if (!getSession(request.params.id)) throw notFound('Сессия не найдена')
    const body = (request.body ?? {}) as { approval_id?: string; tool_call_id?: string; allow?: boolean }
    const approvalId = String(body.approval_id ?? body.tool_call_id ?? '')
    if (!approvalId) throw badRequest('Укажите approval_id')
    const allowed = Boolean(body.allow)
    const ok = approveRun(request.params.id, approvalId, allowed)
    if (!ok) throw notFound('Запрос на подтверждение не найден (возможно, уже обработан)')
    return { ok: true, allow: allowed }
  })

  // SSE stream of events + live message deltas for one session.
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/stream',
    (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const session = getSession(request.params.id)
      if (!session) throw notFound('Сессия не найдена')
      openSse(reply)
      writeSse(reply, { channel: 'hello', session_id: session.id })

      const unsubscribe = bus.subscribe((envelope) => {
        if (envelope.channel === 'event') {
          if (envelope.event.session_id !== session.id) return
        } else if (envelope.channel === 'delta') {
          if (envelope.session_id !== session.id) return
        } else if (envelope.channel === 'session') {
          if (envelope.session.id !== session.id) return
        } else if (envelope.channel === 'tasks') {
          if (envelope.session_id !== session.id) return
        } else {
          return
        }
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
    },
  )

  app.get<{ Querystring: { session?: string; types?: string; limit?: string; q?: string; since?: string } }>(
    '/api/events',
    async (request) => {
      const { session, types, limit, q, since } = request.query
      return listEvents({
        sessionId: session,
        types: types ? types.split(',').filter(Boolean) : undefined,
        limit: limit ? Number(limit) : 500,
        query: q,
        since: since ? Number(since) : undefined,
      })
    },
  )
}

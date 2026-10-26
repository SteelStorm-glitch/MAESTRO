import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { WebSocketServer } from 'ws'
import { initDatabase, closeDatabase } from './db/client'
import { seedDefaults } from './db/seed'
import { resetStaleSessions } from './db/repo/sessions'
import { setRequestObserver } from './providers/base'
import { bus } from './events/bus'
import { logger } from './lib/logger'
import { toHttpError } from './http/errors'
import { providerRoutes } from './routes/providers'
import { modelRoutes } from './routes/models'
import { roleRoutes } from './routes/roles'
import { orchestraRoutes } from './routes/orchestras'
import { projectRoutes } from './routes/projects'
import { fsRoutes } from './routes/fs'
import { sessionRoutes } from './routes/sessions'
import { watchers } from './fs/watcher'
import { terminals } from './terminal/manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 5117)
const HOST = process.env.HOST ?? '127.0.0.1'
const VERSION = '0.1.0'

async function buildServer() {
  const app = Fastify({
    logger: false,
    bodyLimit: 32 * 1024 * 1024,
    trustProxy: false,
  })

  await app.register(cors, {
    origin: (origin, callback) => {
      // Local app: allow same-origin, the Vite dev server and localhost tools.
      if (!origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) callback(null, true)
      else callback(null, false)
    },
  })

  // Accept empty bodies on POST/PATCH (e.g. test/validate endpoints) instead of Fastify's 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8')
    if (!text.trim()) {
      done(null, {})
      return
    }
    try {
      done(null, JSON.parse(text))
    } catch {
      const error = new Error('Некорректный JSON в теле запроса')
      ;(error as Error & { statusCode?: number }).statusCode = 400
      done(error, undefined)
    }
  })

  app.addHook('onRequest', async (request) => {
    // CORS preflight (OPTIONS) never carries custom headers, so it must bypass the token check.
    const readOnly = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS'
    if (request.url.startsWith('/api') && !readOnly) {
      const token = process.env.MAESTRO_TOKEN
      if (token && request.headers['x-maestro-token'] !== token) {
        const error = new Error('Неверный локальный токен')
        ;(error as Error & { statusCode?: number }).statusCode = 401
        throw error
      }
    }
  })

  app.setErrorHandler((error, request, reply) => {
    const httpError = toHttpError(error)
    if (httpError.statusCode >= 500) {
      logger.error(`${request.method} ${request.url} → ${httpError.statusCode}`, { message: httpError.message })
    } else if (httpError.statusCode !== 404) {
      logger.warn(`${request.method} ${request.url} → ${httpError.statusCode}`, { message: httpError.message })
    }
    reply.code(httpError.statusCode).send({
      error: {
        code: httpError.code,
        message: httpError.message,
        ...(httpError.details !== undefined ? { details: httpError.details } : {}),
      },
    })
  })

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'maestro',
    version: VERSION,
    node: process.version,
    platform: process.platform,
    uptime_s: Math.round(process.uptime()),
    pid: process.pid,
  }))

  app.get('/api/meta', async () => ({
    version: VERSION,
    tools: Object.keys(await import('./tools').then((m) => m.TOOL_CATALOG)),
    strategies: ['conductor', 'pipeline', 'council'],
    protocols: ['openai-compatible', 'anthropic', 'gemini'],
  }))

  await app.register(providerRoutes)
  await app.register(modelRoutes)
  await app.register(roleRoutes)
  await app.register(orchestraRoutes)
  await app.register(projectRoutes)
  await app.register(fsRoutes)
  await app.register(sessionRoutes)

  // Serve the built frontend when present (production mode).
  const webDist = process.env.MAESTRO_WEB_DIST
    ? path.resolve(process.env.MAESTRO_WEB_DIST)
    : path.resolve(__dirname, '../../web/dist')
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.code(404).send({ error: { code: 'not_found', message: 'Маршрут не найден' } })
        return
      }
      reply.sendFile('index.html')
    })
    logger.info(`Serving web build from ${webDist}`)
  } else {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api')) {
        reply.code(404).send({ error: { code: 'not_found', message: 'Маршрут не найден' } })
        return
      }
      reply
        .code(200)
        .type('text/html')
        .send(
          '<html><body style="font-family:system-ui;background:#0A0A0B;color:#F4F4F5;padding:40px">' +
            '<h1>MAESTRO server</h1><p>API работает. Для интерфейса запустите <code>pnpm dev</code> ' +
            '(Vite на <a style="color:#8B8BF5" href="http://localhost:5173">localhost:5173</a>).</p></body></html>',
        )
    })
  }

  return app
}

async function main() {
  initDatabase()
  seedDefaults()
  const stale = resetStaleSessions()
  if (stale > 0) logger.warn(`Marked ${stale} stale session(s) as error`)

  setRequestObserver((info) => {
    bus.emit(null, 'provider.request', { ...info, at: Date.now() })
  })

  const app = await buildServer()

  const wss = new WebSocketServer({ noServer: true })
  app.server.on('upgrade', (request, socket, head) => {
    let url: URL
    try {
      url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/api/terminal') {
      socket.destroy()
      return
    }
    // Reject cross-site WebSocket hijacking: browsers always send Origin on WebSocket upgrades.
    const origin = request.headers.origin
    if (origin) {
      let allowed = false
      try {
        const parsed = new URL(origin)
        const host = parsed.hostname.replace(/^\[|\]$/g, '')
        allowed =
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          (host === '127.0.0.1' || host === 'localhost' || host === '::1')
      } catch {
        allowed = false
      }
      if (!allowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
    }
    const requiredToken = process.env.MAESTRO_TOKEN
    if (requiredToken && url.searchParams.get('token') !== requiredToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const projectId = url.searchParams.get('project')
    if (!projectId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      void terminals.attach(projectId, ws)
    })
  })

  try {
    await app.listen({ port: PORT, host: HOST })
    logger.info(`MAESTRO server listening on http://${HOST}:${PORT}`)
    logger.info(`Data directory: ${process.env.MAESTRO_HOME ?? '~/.maestro'}`)
  } catch (error: unknown) {
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'EADDRINUSE') {
      logger.warn(
        `Порт ${PORT} уже занят (сервер уже запущен на http://${HOST}:${PORT}). Dev-процесс переходит в режим ожидания, чтобы Vite продолжал работу.`,
      )
      await new Promise(() => {})
      return
    }
    throw error
  }

  const shutdown = async () => {
    logger.info('Shutting down…')
    watchers.closeAll()
    terminals.closeAll()
    try {
      await app.close()
    } catch {
      /* ignore */
    }
    closeDatabase()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: reason instanceof Error ? reason.message : String(reason) })
  })
}

main().catch((error) => {
  logger.error('Fatal startup error', { message: error instanceof Error ? error.message : String(error) })
  console.error(error)
  process.exit(1)
})

import type { FastifyInstance } from 'fastify'
import { createProject, deleteProject, getProject, listProjects } from '../db/repo/projects'
import { watchers } from '../fs/watcher'
import { stopProjectRuns } from '../orchestra/engine'
import { terminals } from '../terminal/manager'
import { badRequest, notFound, toHttpError } from '../http/errors'

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/projects', async () => listProjects())

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    const project = getProject(request.params.id)
    if (!project) throw notFound('Проект не найден')
    return project
  })

  app.post('/api/projects', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; root_path?: string }
    const rootPath = String(body.root_path ?? '').trim()
    if (!rootPath) throw badRequest('Укажите root_path — путь к папке проекта')
    try {
      const project = createProject({ name: body.name, root_path: rootPath })
      reply.code(201)
      return project
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw badRequest('Папка не существует')
      }
      throw toHttpError(error)
    }
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    if (!getProject(request.params.id)) throw notFound('Проект не найден')
    await stopProjectRuns(request.params.id)
    if (!deleteProject(request.params.id)) throw notFound('Проект не найден')
    watchers.stop(request.params.id)
    terminals.close(request.params.id)
    reply.code(204)
    return null
  })
}

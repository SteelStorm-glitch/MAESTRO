import type { FastifyInstance } from 'fastify'
import type { RoleInput } from '@maestro/shared'
import { createRole, deleteRole, getRole, listRoles, updateRole } from '../db/repo/roles'
import { badRequest, notFound } from '../http/errors'

const PERMISSIONS = ['read', 'write', 'admin']
const SHELL_MODES = ['off', 'confirm', 'auto']

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/roles', async () => listRoles())

  app.get<{ Params: { id: string } }>('/api/roles/:id', async (request) => {
    const role = getRole(request.params.id)
    if (!role) throw notFound('Роль не найдена')
    return role
  })

  app.post('/api/roles', async (request, reply) => {
    const input = parseRoleInput(request.body, true)
    if (!input.name) throw badRequest('Укажите имя роли')
    reply.code(201)
    return createRole(input as RoleInput)
  })

  app.patch<{ Params: { id: string } }>('/api/roles/:id', async (request) => {
    if (!getRole(request.params.id)) throw notFound('Роль не найдена')
    const updated = updateRole(request.params.id, parseRoleInput(request.body, false))
    if (!updated) throw notFound('Роль не найдена')
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/roles/:id', async (request, reply) => {
    if (!deleteRole(request.params.id)) throw notFound('Роль не найдена')
    reply.code(204)
    return null
  })
}

function parseRoleInput(body: unknown, requireName: boolean): Partial<RoleInput> {
  const data = (body ?? {}) as Record<string, unknown>
  const input: Partial<RoleInput> = {}
  if (data.name !== undefined || requireName) {
    const name = String(data.name ?? '').trim()
    if (!name) throw badRequest('Укажите имя роли')
    input.name = name
  }
  if (data.description !== undefined) input.description = String(data.description)
  if (data.system_prompt !== undefined) input.system_prompt = String(data.system_prompt)
  if (data.model_id !== undefined) input.model_id = data.model_id ? String(data.model_id) : null
  if (data.temperature !== undefined) {
    const temperature = Number(data.temperature)
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw badRequest('Температура должна быть в диапазоне 0–2')
    }
    input.temperature = temperature
  }
  if (data.tools !== undefined) {
    if (!Array.isArray(data.tools)) throw badRequest('tools должен быть массивом имён инструментов')
    input.tools = data.tools.map(String)
  }
  if (data.permission !== undefined) {
    if (!PERMISSIONS.includes(String(data.permission))) throw badRequest('permission: read | write | admin')
    input.permission = String(data.permission) as RoleInput['permission']
  }
  if (data.shell_mode !== undefined) {
    if (!SHELL_MODES.includes(String(data.shell_mode))) throw badRequest('shell_mode: off | confirm | auto')
    input.shell_mode = String(data.shell_mode) as RoleInput['shell_mode']
  }
  if (data.color !== undefined) {
    const color = String(data.color)
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw badRequest('Цвет должен быть в формате #RRGGBB')
    input.color = color
  }
  return input
}

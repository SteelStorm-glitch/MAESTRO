import type { FastifyInstance } from 'fastify'
import type { OrchestraInput, OrchestraStrategy, Role } from '@maestro/shared'
import {
  createOrchestra,
  deleteOrchestra,
  getOrchestra,
  listOrchestras,
  updateOrchestra,
} from '../db/repo/orchestras'
import { createRole, listRoles } from '../db/repo/roles'
import { getModel } from '../db/repo/models'
import { validateOrchestra } from '../orchestra/validate'
import { badRequest, notFound } from '../http/errors'

const STRATEGIES: OrchestraStrategy[] = ['conductor', 'pipeline', 'council']

function parseOrchestraInput(body: unknown, requireName: boolean): Partial<OrchestraInput> {
  const data = (body ?? {}) as Record<string, unknown>
  const input: Partial<OrchestraInput> = {}
  if (data.name !== undefined || requireName) {
    const name = String(data.name ?? '').trim()
    if (!name) throw badRequest('Укажите имя оркестра')
    input.name = name
  }
  if (data.strategy !== undefined) {
    if (!STRATEGIES.includes(String(data.strategy) as OrchestraStrategy)) {
      throw badRequest('strategy: conductor | pipeline | council')
    }
    input.strategy = String(data.strategy) as OrchestraStrategy
  }
  for (const key of ['conductor_role_id', 'verifier_role_id', 'fixer_role_id'] as const) {
    if (data[key] !== undefined) input[key] = data[key] ? String(data[key]) : null
  }
  if (data.max_rounds !== undefined) {
    const rounds = Number(data.max_rounds)
    if (!Number.isFinite(rounds) || rounds < 1 || rounds > 50) throw badRequest('max_rounds: 1–50')
    input.max_rounds = Math.round(rounds)
  }
  if (data.budget_tokens !== undefined) {
    const budget = Number(data.budget_tokens)
    if (!Number.isFinite(budget) || budget < 1000) throw badRequest('budget_tokens должен быть ≥ 1000')
    input.budget_tokens = Math.round(budget)
  }
  if (data.approval_mode !== undefined) {
    if (!['auto', 'confirm', 'deny'].includes(String(data.approval_mode))) {
      throw badRequest('approval_mode: auto | confirm | deny')
    }
    input.approval_mode = String(data.approval_mode) as OrchestraInput['approval_mode']
  }
  if (data.config_json !== undefined && data.config_json !== null) {
    if (typeof data.config_json !== 'object') throw badRequest('config_json должен быть объектом')
    input.config_json = data.config_json as Record<string, unknown>
  }
  if (data.members !== undefined) {
    if (!Array.isArray(data.members)) throw badRequest('members должен быть массивом')
    input.members = data.members.map((item, index) => {
      const member = (item ?? {}) as Record<string, unknown>
      const roleId = String(member.role_id ?? member.roleId ?? '')
      if (!roleId) throw badRequest('У каждого участника должен быть role_id')
      return { role_id: roleId, position: Number(member.position ?? index) }
    })
  }
  return input
}

export async function orchestraRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/orchestras', async () => listOrchestras())

  app.get<{ Params: { id: string } }>('/api/orchestras/:id', async (request) => {
    const orchestra = getOrchestra(request.params.id)
    if (!orchestra) throw notFound('Оркестр не найден')
    return orchestra
  })

  app.post('/api/orchestras', async (request, reply) => {
    const input = parseOrchestraInput(request.body, true)
    if (!input.name) throw badRequest('Укажите имя оркестра')
    validateMembers(input)
    reply.code(201)
    return createOrchestra(input as OrchestraInput)
  })

  app.patch<{ Params: { id: string } }>('/api/orchestras/:id', async (request) => {
    if (!getOrchestra(request.params.id)) throw notFound('Оркестр не найден')
    const input = parseOrchestraInput(request.body, false)
    validateMembers(input)
    const updated = updateOrchestra(request.params.id, input)
    if (!updated) throw notFound('Оркестр не найден')
    return updated
  })

  app.delete<{ Params: { id: string } }>('/api/orchestras/:id', async (request, reply) => {
    if (!deleteOrchestra(request.params.id)) throw notFound('Оркестр не найден')
    reply.code(204)
    return null
  })

  app.post<{ Params: { id: string } }>('/api/orchestras/:id/validate', async (request) => {
    const orchestra = getOrchestra(request.params.id)
    if (!orchestra) throw notFound('Оркестр не найден')
    return validateOrchestra(orchestra, listRoles())
  })

  app.get<{ Params: { id: string } }>('/api/orchestras/:id/export', async (request) => {
    const orchestra = getOrchestra(request.params.id)
    if (!orchestra) throw notFound('Оркестр не найден')
    const roles = listRoles()
    const roleById = new Map(roles.map((role) => [role.id, role]))
    const members = orchestra.members
      .map((member) => roleById.get(member.role_id))
      .filter((role): role is Role => Boolean(role))
    const modelHints = new Map<string, ReturnType<typeof getModel>>()
    for (const role of members) {
      if (role.model_id) modelHints.set(role.model_id, getModel(role.model_id))
    }
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      orchestra: {
        name: orchestra.name,
        strategy: orchestra.strategy,
        conductor: orchestra.conductor_role_id ? roleById.get(orchestra.conductor_role_id)?.name ?? null : null,
        verifier: orchestra.verifier_role_id ? roleById.get(orchestra.verifier_role_id)?.name ?? null : null,
        fixer: orchestra.fixer_role_id ? roleById.get(orchestra.fixer_role_id)?.name ?? null : null,
        max_rounds: orchestra.max_rounds,
        budget_tokens: orchestra.budget_tokens,
        approval_mode: orchestra.approval_mode,
        config_json: orchestra.config_json,
        members: orchestra.members.map((member) => ({
          role: roleById.get(member.role_id)?.name ?? 'unknown',
          position: member.position,
        })),
      },
      roles: members.map((role) => {
        const model = role.model_id ? modelHints.get(role.model_id) : null
        return {
          name: role.name,
          description: role.description,
          system_prompt: role.system_prompt,
          temperature: role.temperature,
          tools: role.tools,
          permission: role.permission,
          shell_mode: role.shell_mode,
          color: role.color,
          model: model
            ? {
                model_id: model.model_id,
                display_name: model.display_name,
                context_window: model.context_window,
                max_output: model.max_output,
                supports_tools: model.supports_tools,
                supports_vision: model.supports_vision,
              }
            : null,
        }
      }),
    }
  })

  app.post('/api/orchestras/import', async (request, reply) => {
    const payload = (request.body ?? {}) as Record<string, unknown>
    const orchestraData = (payload.orchestra ?? payload) as Record<string, unknown>
    const rolesData = Array.isArray(payload.roles) ? payload.roles : []
    const name = String(orchestraData.name ?? '').trim()
    if (!name) throw badRequest('В импорте нет имени оркестра')

    const existingRoles = listRoles()
    const byName = new Map(existingRoles.map((role) => [role.name.toLowerCase(), role]))
    const warnings: string[] = []

    for (const item of rolesData) {
      const data = item as Record<string, unknown>
      const roleName = String(data.name ?? '').trim()
      if (!roleName) continue
      if (byName.has(roleName.toLowerCase())) continue
      const role = createRole({
        name: roleName,
        description: String(data.description ?? ''),
        system_prompt: String(data.system_prompt ?? ''),
        model_id: null,
        temperature: Number(data.temperature ?? 0.7),
        tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
        permission: (data.permission as Role['permission']) ?? 'write',
        shell_mode: (data.shell_mode as Role['shell_mode']) ?? 'off',
        color: String(data.color ?? '#8B8BF5'),
      })
      byName.set(role.name.toLowerCase(), role)
      if (data.model) warnings.push(`Роль «${roleName}»: выберите модель вручную (импортирована без модели)`)
    }

    const members = Array.isArray(orchestraData.members) ? orchestraData.members : []
    const memberInputs = members
      .map((item, index) => {
        const member = item as Record<string, unknown>
        const roleName = String(member.role ?? member.name ?? '').trim().toLowerCase()
        const role = byName.get(roleName)
        if (!role) {
          warnings.push(`Роль «${String(member.role ?? '')}» не найдена — участник пропущен`)
          return null
        }
        return { role_id: role.id, position: Number(member.position ?? index) }
      })
      .filter((item): item is { role_id: string; position: number } => Boolean(item))
    if (memberInputs.length === 0) throw badRequest('Ни один участник оркестра не найден в ролях')

    const lookupRole = (value: unknown) => {
      if (!value) return null
      return byName.get(String(value).trim().toLowerCase())?.id ?? null
    }

    const orchestra = createOrchestra({
      name,
      strategy: (String(orchestraData.strategy ?? 'conductor') as OrchestraStrategy) ?? 'conductor',
      conductor_role_id: lookupRole(orchestraData.conductor),
      verifier_role_id: lookupRole(orchestraData.verifier),
      fixer_role_id: lookupRole(orchestraData.fixer),
      max_rounds: Number(orchestraData.max_rounds ?? 6),
      budget_tokens: Number(orchestraData.budget_tokens ?? 500000),
      approval_mode: (orchestraData.approval_mode as OrchestraInput['approval_mode']) ?? 'auto',
      config_json: (orchestraData.config_json as Record<string, unknown>) ?? {},
      members: memberInputs,
    })
    reply.code(201)
    return { orchestra, warnings }
  })
}

function validateMembers(input: Partial<OrchestraInput>): void {
  const roles = listRoles().map((role) => role.id)
  const roleSet = new Set(roles)
  for (const member of input.members ?? []) {
    if (!roleSet.has(member.role_id)) throw badRequest(`Роль ${member.role_id} не существует`)
  }
  for (const key of ['conductor_role_id', 'verifier_role_id', 'fixer_role_id'] as const) {
    const value = input[key]
    if (value && !roleSet.has(value)) throw badRequest(`Роль ${value} не существует`)
  }
}

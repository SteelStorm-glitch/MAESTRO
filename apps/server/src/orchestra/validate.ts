import type { Orchestra, Role, ValidateResult, ValidationIssue, Model } from '@maestro/shared'
import { getModel } from '../db/repo/models'

export function validateOrchestra(orchestra: Orchestra, roles: Role[]): ValidateResult {
  const issues: ValidationIssue[] = []
  const roleMap = new Map(roles.map((role) => [role.id, role]))
  const memberRoles = orchestra.members
    .map((member) => roleMap.get(member.role_id))
    .filter((role): role is Role => Boolean(role))

  if (memberRoles.length === 0) {
    issues.push({ code: 'no_members', message: 'В оркестре нет участников', severity: 'error' })
  }
  if (orchestra.members.length !== memberRoles.length) {
    issues.push({
      code: 'missing_roles',
      message: 'Некоторые роли оркестра были удалены — удалите их из состава',
      severity: 'error',
    })
  }

  const models: Array<{ role: Role; model: Model | null }> = memberRoles.map((role) => ({
    role,
    model: role.model_id ? getModel(role.model_id) : null,
  }))

  for (const { role, model } of models) {
    if (!role.model_id) {
      issues.push({
        code: 'role_without_model',
        message: `У роли «${role.name}» не выбрана модель`,
        severity: 'error',
      })
    } else if (!model) {
      issues.push({
        code: 'role_model_not_found',
        message: `Модель роли «${role.name}» не найдена (возможно, удалена)`,
        severity: 'error',
      })
    } else if (!model.enabled) {
      issues.push({
        code: 'role_model_disabled',
        message: `Модель «${model.display_name}» роли «${role.name}» отключена`,
        severity: 'error',
      })
    }
  }

  if (orchestra.strategy === 'conductor') {
    if (!orchestra.conductor_role_id) {
      issues.push({ code: 'no_conductor', message: 'Для стратегии conductor не выбран дирижёр', severity: 'error' })
    } else if (!roleMap.has(orchestra.conductor_role_id)) {
      issues.push({ code: 'conductor_missing', message: 'Роль дирижёра не найдена', severity: 'error' })
    } else if (!orchestra.members.some((member) => member.role_id === orchestra.conductor_role_id)) {
      issues.push({ code: 'conductor_not_member', message: 'Дирижёр не входит в состав оркестра', severity: 'error' })
    }
  }

  for (const key of ['verifier_role_id', 'fixer_role_id'] as const) {
    const id = orchestra[key]
    if (!id) continue
    if (!roleMap.has(id)) {
      issues.push({ code: `${key}_missing`, message: 'Роль проверяющего/исправителя не найдена', severity: 'error' })
    } else if (!orchestra.members.some((member) => member.role_id === id)) {
      issues.push({
        code: `${key}_not_member`,
        message: 'Проверяющий или исправитель не входит в состав оркестра',
        severity: 'warning',
      })
    }
  }

  if (orchestra.strategy === 'pipeline') {
    if (memberRoles.length < 2) {
      issues.push({
        code: 'pipeline_too_short',
        message: 'Для pipeline нужно минимум две роли',
        severity: 'warning',
      })
    }
    const verifierWithoutModel = models.filter((item) => !item.model?.enabled)
    if (verifierWithoutModel.length > 0) {
      issues.push({
        code: 'pipeline_models',
        message: 'Часть цепочки без рабочей модели — этап не выполнится',
        severity: 'warning',
      })
    }
  }

  const cheapestContext = Math.min(
    ...models.map((item) => (item.model?.context_window && item.model.context_window > 0 ? item.model.context_window : 32000)),
  )
  if (Number.isFinite(cheapestContext) && orchestra.budget_tokens < cheapestContext) {
    issues.push({
      code: 'small_budget',
      message: 'Лимит токенов меньше контекстного окна самой маленькой модели — запуск остановится почти сразу',
      severity: 'warning',
    })
  }
  if (orchestra.max_rounds < 1) {
    issues.push({ code: 'bad_rounds', message: 'Максимум раундов должен быть ≥ 1', severity: 'error' })
  }
  if (orchestra.max_rounds > 20) {
    issues.push({ code: 'many_rounds', message: 'Более 20 раундов — риск бесконечного цикла', severity: 'warning' })
  }
  if (orchestra.budget_tokens < 10_000) {
    issues.push({ code: 'tiny_budget', message: 'Слишком маленький лимит токенов', severity: 'warning' })
  }

  return { ok: issues.every((issue) => issue.severity !== 'error'), issues }
}

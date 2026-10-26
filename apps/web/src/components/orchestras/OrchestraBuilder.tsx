import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, Download, Plus, Trash2, XCircle } from 'lucide-react'
import type { Orchestra, OrchestraStrategy, ValidateResult } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn } from '../../lib/utils'
import { Modal } from '../common/Modal'
import { Spinner } from '../common/Spinner'

const STRATEGIES: Array<{ value: OrchestraStrategy; label: string; hint: string }> = [
  { value: 'conductor', label: 'conductor', hint: 'дирижёр планирует, раскидывает задачи, аудитор проверяет' },
  { value: 'pipeline', label: 'pipeline', hint: 'фиксированная цепочка: выход роли N → вход роли N+1' },
  { value: 'council', label: 'council', hint: 'все отвечают параллельно, дирижёр синтезирует' },
]

export function OrchestraBuilder({
  open,
  orchestra,
  onClose,
}: {
  open: boolean
  orchestra: Orchestra | null
  onClose: () => void
}) {
  const {
    roles,
    models,
    saveOrchestra,
    deleteOrchestra,
    validateOrchestra,
    exportOrchestra,
    notify,
    handleError,
  } = useAppStore()

  const [name, setName] = useState('')
  const [strategy, setStrategy] = useState<OrchestraStrategy>('conductor')
  const [conductorId, setConductorId] = useState<string | null>(null)
  const [verifierId, setVerifierId] = useState<string | null>(null)
  const [fixerId, setFixerId] = useState<string | null>(null)
  const [maxRounds, setMaxRounds] = useState(6)
  const [budget, setBudget] = useState(500000)
  const [approvalMode, setApprovalMode] = useState<'auto' | 'confirm' | 'deny'>('auto')
  const [members, setMembers] = useState<string[]>([])
  const [addRoleId, setAddRoleId] = useState('')
  const [validation, setValidation] = useState<ValidateResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<Orchestra | null>(orchestra)

  useEffect(() => {
    if (!open) return
    setName(orchestra?.name ?? 'Новый оркестр')
    setStrategy(orchestra?.strategy ?? 'conductor')
    setConductorId(orchestra?.conductor_role_id ?? null)
    setVerifierId(orchestra?.verifier_role_id ?? null)
    setFixerId(orchestra?.fixer_role_id ?? null)
    setMaxRounds(orchestra?.max_rounds ?? 6)
    setBudget(orchestra?.budget_tokens ?? 500000)
    setApprovalMode(orchestra?.approval_mode ?? 'auto')
    const memberIds = orchestra
      ? [...orchestra.members].sort((a, b) => a.position - b.position).map((member) => member.role_id)
      : []
    setMembers(memberIds)
    if (!orchestra && conductorId === null && memberIds[0]) setConductorId(memberIds[0])
    setAddRoleId('')
    setValidation(null)
    setSaved(orchestra)
  }, [open, orchestra])

  const memberRoles = useMemo(
    () => members.map((id) => roles.find((role) => role.id === id)).filter((role): role is NonNullable<typeof role> => Boolean(role)),
    [members, roles],
  )
  const availableRoles = roles.filter((role) => !members.includes(role.id))

  const addMember = (roleId: string) => {
    if (!roleId || members.includes(roleId)) return
    setMembers([...members, roleId])
    setAddRoleId('')
    if (!conductorId && strategy === 'conductor') setConductorId(roleId)
  }

  const moveMember = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= members.length) return
    const next = [...members]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item!)
    setMembers(next)
  }

  const removeMember = (roleId: string) => {
    setMembers(members.filter((id) => id !== roleId))
    if (conductorId === roleId) setConductorId(null)
    if (verifierId === roleId) setVerifierId(null)
    if (fixerId === roleId) setFixerId(null)
  }

  const save = async (): Promise<Orchestra | null> => {
    setSaving(true)
    try {
      const result = await saveOrchestra(
        {
          name: name.trim(),
          strategy,
          conductor_role_id: conductorId,
          verifier_role_id: verifierId,
          fixer_role_id: fixerId,
          max_rounds: maxRounds,
          budget_tokens: budget,
          approval_mode: approvalMode,
          members: members.map((roleId, index) => ({ role_id: roleId, position: index })),
        },
        saved?.id,
      )
      setSaved(result)
      notify('Оркестр сохранён', 'success')
      const issues = await validateOrchestra(result.id)
      setValidation(issues)
      return result
    } catch (error) {
      handleError(error)
      return null
    } finally {
      setSaving(false)
    }
  }

  const validate = async () => {
    const target = saved ?? (await save())
    if (!target) return
    try {
      setValidation(await validateOrchestra(target.id))
    } catch (error) {
      handleError(error)
    }
  }

  const remove = async () => {
    if (!saved) return
    if (!window.confirm(`Удалить оркестр «${saved.name}»?`)) return
    try {
      await deleteOrchestra(saved.id)
      notify('Оркестр удалён', 'success')
      onClose()
    } catch (error) {
      handleError(error)
    }
  }

  const exportOne = async () => {
    const target = saved ?? (await save())
    if (!target) return
    try {
      const data = await exportOrchestra(target.id)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `orchestra-${target.name.replace(/\s+/g, '-')}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={saved ? `Оркестр · ${saved.name}` : 'Новый оркестр'}
      subtitle="Роли, стратегия и лимиты запуска"
      footer={
        <>
          {saved && (
            <button className="btn btn-danger mr-auto" onClick={() => void remove()}>
              <Trash2 size={12} /> Удалить
            </button>
          )}
          <button className="btn" onClick={() => void exportOne()}>
            <Download size={12} /> Экспорт
          </button>
          <button className="btn" onClick={() => void validate()}>
            <CheckCircle2 size={12} /> Проверить
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner size={12} className="text-current" />}
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_220px] gap-3">
          <div>
            <label className="label">Название</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Dev Team" />
          </div>
          <div>
            <label className="label">Стратегия</label>
            <select className="input" value={strategy} onChange={(event) => setStrategy(event.target.value as OrchestraStrategy)}>
              {STRATEGIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-[10px] text-faint">{STRATEGIES.find((item) => item.value === strategy)?.hint}</div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="label">Раундов</label>
            <input
              className="input font-mono"
              type="number"
              min={1}
              max={50}
              value={maxRounds}
              onChange={(event) => setMaxRounds(Number(event.target.value))}
            />
          </div>
          <div>
            <label className="label">Бюджет токенов</label>
            <input
              className="input font-mono"
              type="number"
              min={1000}
              step={10000}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Подтверждения</label>
            <div className="flex gap-1">
              {(['auto', 'confirm', 'deny'] as const).map((mode) => (
                <button
                  key={mode}
                  className={cn(
                    'flex-1 rounded border px-2 py-1.5 text-[11px]',
                    approvalMode === mode
                      ? 'border-accent/60 bg-accent/10 text-primary'
                      : 'border-border text-dim hover:bg-elevated',
                  )}
                  onClick={() => setApprovalMode(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="orchestra-conductor-select">Роль дирижёра</label>
            <select
              id="orchestra-conductor-select"
              data-testid="orchestra-conductor-select"
              className="input"
              value={conductorId ?? ''}
              onChange={(event) => setConductorId(event.target.value || null)}
            >
              <option value="">—</option>
              {memberRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Аудитор</label>
            <select className="input" value={verifierId ?? ''} onChange={(event) => setVerifierId(event.target.value || null)}>
              <option value="">— не выбран —</option>
              {memberRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Багхантер</label>
            <select className="input" value={fixerId ?? ''} onChange={(event) => setFixerId(event.target.value || null)}>
              <option value="">— не выбран —</option>
              {memberRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Состав и порядок</label>
            <div className="flex items-center gap-1.5">
              <select
                className="h-7 rounded border border-border bg-base px-1.5 text-[11px] text-dim outline-none"
                value={addRoleId}
                onChange={(event) => setAddRoleId(event.target.value)}
              >
                <option value="">выбрать роль…</option>
                {availableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <button className="btn h-7 px-2 text-[11px]" onClick={() => addMember(addRoleId)} disabled={!addRoleId}>
                <Plus size={11} /> добавить
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded border border-border">
            {memberRoles.length === 0 && (
              <div className="px-3 py-5 text-center text-[11px] text-faint">Добавьте роли в состав оркестра</div>
            )}
            {memberRoles.map((role, index) => {
              const model = models.find((item) => item.id === role.model_id) ?? null
              return (
                <div
                  key={role.id}
                  className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
                >
                  <span className="w-4 text-right font-mono text-[10px] text-faint">{index + 1}</span>
                  <span className="h-2 w-2 rounded-full" style={{ background: role.color }} />
                  <span className="text-[12px] text-primary">{role.name}</span>
                  <span className="truncate text-[10px] text-faint">
                    {model?.display_name ?? 'нет модели'}
                    {!model?.supports_tools && model ? ' · без tools' : ''}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button className="icon-btn h-5 w-5" onClick={() => moveMember(index, -1)} disabled={index === 0}>
                      <ArrowUp size={11} />
                    </button>
                    <button
                      className="icon-btn h-5 w-5"
                      onClick={() => moveMember(index, 1)}
                      disabled={index === memberRoles.length - 1}
                    >
                      <ArrowDown size={11} />
                    </button>
                    <button className="icon-btn h-5 w-5 hover:text-danger" onClick={() => removeMember(role.id)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {validation && (
          <div className="rounded border border-border bg-base">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
              {validation.ok ? (
                <CheckCircle2 size={13} className="text-ok" />
              ) : (
                <XCircle size={13} className="text-danger" />
              )}
              <span className={validation.ok ? 'text-ok' : 'text-danger'}>
                {validation.ok ? 'Оркестр готов к запуску' : 'Есть блокирующие проблемы'}
              </span>
              <span className="ml-auto text-[10px] text-faint">проверено</span>
            </div>
            <div className="max-h-[180px] overflow-y-auto px-3 py-2">
              {validation.issues.length === 0 && (
                <div className="text-[11px] text-faint">Замечаний нет.</div>
              )}
              {validation.issues.map((issue, index) => (
                <div key={index} className="flex items-start gap-2 py-0.5 text-[11px]">
                  <span
                    className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: issue.severity === 'error' ? 'var(--danger)' : 'var(--warn)' }}
                  />
                  <span className={issue.severity === 'error' ? 'text-danger' : 'text-warn'}>{issue.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

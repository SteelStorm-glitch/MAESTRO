import { useMemo } from 'react'
import { Bot, Crown, Filter, ShieldCheck, Wrench } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useSessionStore } from '../../store/session'
import { cn, formatCost, formatTokens } from '../../lib/utils'
import { Empty } from '../common/Empty'
import { Spinner } from '../common/Spinner'

export function AgentList() {
  const { orchestras, orchestraId, roles, models, providers, sessions, setTab } = useAppStore()
  const session = useSessionStore()
  const activeOrchestraId = session.session?.orchestra_id ?? orchestraId
  const orchestra = orchestras.find((item) => item.id === activeOrchestraId) ?? null

  const members = useMemo(() => {
    if (!orchestra) return []
    return [...orchestra.members]
      .sort((a, b) => a.position - b.position)
      .map((member) => roles.find((role) => role.id === member.role_id))
      .filter((role): role is NonNullable<typeof role> => Boolean(role))
  }, [orchestra, roles])

  const orchestraStats = useMemo(() => {
    const related = orchestra ? sessions.filter((item) => item.orchestra_id === orchestra.id) : []
    return related.reduce(
      (acc, item) => ({
        count: acc.count + 1,
        tokensIn: acc.tokensIn + item.tokens_in,
        tokensOut: acc.tokensOut + item.tokens_out,
        cost: acc.cost + item.cost,
      }),
      { count: 0, tokensIn: 0, tokensOut: 0, cost: 0 },
    )
  }, [sessions, orchestra])

  const perRoleUsage = useMemo(() => {
    const usage = new Map<string, { in: number; out: number }>()
    for (const message of session.messages) {
      if (!message.role_id) continue
      const current = usage.get(message.role_id) ?? { in: 0, out: 0 }
      current.in += message.tokens_in
      current.out += message.tokens_out
      usage.set(message.role_id, current)
    }
    return usage
  }, [session.messages])

  if (!orchestra) {
    return (
      <Empty
        icon={Bot}
        title="Оркестр не выбран"
        description="Соберите оркестр из ролей, чтобы запускать задачи."
        action={
          <button className="btn btn-primary" onClick={() => setTab('orchestras')}>
            К оркестрам
          </button>
        }
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-primary">{orchestra.name}</span>
          <span className="chip">{orchestra.strategy}</span>
          <span className="ml-auto text-[10px] text-faint">{members.length} агентов</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-faint">
          <span>раунды ≤ {orchestra.max_rounds}</span>
          <span>·</span>
          <span>бюджет {formatTokens(orchestra.budget_tokens)}</span>
          <span>·</span>
          <span>{orchestra.approval_mode}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {members.map((role) => {
          const model = models.find((item) => item.id === role.model_id) ?? null
          const provider = providers.find((item) => item.id === model?.provider_id) ?? null
          const status = session.agentStatus[role.id]
          const usage = perRoleUsage.get(role.id) ?? { in: 0, out: 0 }
          const isFiltered = session.roleFilter === role.id
          const isConductor = orchestra.conductor_role_id === role.id
          const isVerifier = orchestra.verifier_role_id === role.id
          const isFixer = orchestra.fixer_role_id === role.id

          return (
            <button
              key={role.id}
              className={cn(
                'mb-1.5 w-full rounded border px-2.5 py-2 text-left transition-colors',
                isFiltered ? 'border-accent/60 bg-active' : 'border-border bg-panel hover:bg-elevated',
              )}
              onClick={() => session.setRoleFilter(isFiltered ? null : role.id)}
              title="Фильтровать timeline по агенту"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: role.color }} />
                <span className="truncate text-[12px] text-primary">{role.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-faint">
                  {isConductor && (
                    <span title="Роль дирижёра" aria-label="Роль дирижёра">
                      <Crown size={11} className="text-accent" />
                    </span>
                  )}
                  {isVerifier && (
                    <span title="Аудитор">
                      <ShieldCheck size={11} className="text-ok" />
                    </span>
                  )}
                  {isFixer && (
                    <span title="Багхантер">
                      <Wrench size={11} className="text-danger" />
                    </span>
                  )}
                  {isFiltered && <Filter size={11} className="text-accent" />}
                </span>
              </div>
              <div className="mt-0.5 truncate pl-4 text-[10px] text-faint" title={`${provider?.name ?? ''} / ${model?.model_id ?? ''}`}>
                {model ? `${model.display_name}${provider ? ` · ${provider.name}` : ''}` : 'модель не выбрана'}
              </div>
              <div className="mt-1 flex items-center gap-2 pl-4">
                {status && status.status !== 'idle' ? (
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-1 text-[10px]',
                      status.status === 'error' ? 'text-danger' : status.status === 'tool' ? 'text-warn' : 'text-accent',
                    )}
                  >
                    {(status.status === 'thinking' || status.status === 'tool') && <Spinner size={9} />}
                    <span className="truncate">
                      {status.status === 'thinking'
                        ? 'думает…'
                        : status.status === 'tool'
                          ? `tool: ${status.detail ?? ''}`
                          : status.status === 'error'
                            ? 'ошибка'
                            : 'готово'}
                    </span>
                  </span>
                ) : (
                  <span className="text-[10px] text-faint">{role.permission === 'read' ? 'read-only' : role.permission}</span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
                  ↑{formatTokens(usage.in)} ↓{formatTokens(usage.out)}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-faint">Сессия</span>
          <span className="font-mono text-dim">
            ↑{formatTokens(session.tokensIn)} ↓{formatTokens(session.tokensOut)} · {formatCost(session.cost)}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, ((session.tokensIn + session.tokensOut) / Math.max(orchestra.budget_tokens, 1)) * 100)}%`,
              background:
                session.tokensIn + session.tokensOut > orchestra.budget_tokens * 0.8 ? 'var(--warn)' : 'var(--accent)',
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-faint">
          <span>
            оркестр: {orchestraStats.count} сессий
          </span>
          <span className="font-mono">
            ↑{formatTokens(orchestraStats.tokensIn)} ↓{formatTokens(orchestraStats.tokensOut)} ·{' '}
            {formatCost(orchestraStats.cost)}
          </span>
        </div>
      </div>
    </div>
  )
}

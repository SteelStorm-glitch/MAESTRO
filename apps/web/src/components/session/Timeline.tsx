import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Bot, Network, Plug, Sparkles } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useSessionStore } from '../../store/session'
import { cn, formatCost, formatTokens, STATUS_LABELS, statusColor } from '../../lib/utils'
import { RoleBadge } from '../common/Badge'
import { Empty } from '../common/Empty'
import { Spinner } from '../common/Spinner'
import { ApprovalCard } from './ApprovalCard'
import { InputBox } from './InputBox'
import { MessageCard, RichText } from './MessageCard'
import { TaskPlan } from './TaskPlan'

export function Timeline() {
  const { roles, orchestras, projects, projectId, orchestraId, sessionId, setTab, providers } = useAppStore()
  const session = useSessionStore()
  const [atBottom, setAtBottom] = useState(true)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const orchestra = orchestras.find((item) => item.id === (session.session?.orchestra_id ?? orchestraId)) ?? null
  const memberRoles = useMemo(() => {
    if (!orchestra) return roles
    const ids = new Set(orchestra.members.map((member) => member.role_id))
    return roles.filter((role) => ids.has(role.id))
  }, [orchestra, roles])

  const visibleMessages = useMemo(
    () => (session.roleFilter ? session.messages.filter((m) => m.role_id === session.roleFilter) : session.messages),
    [session.messages, session.roleFilter],
  )

  const pendings = useMemo(
    () =>
      Object.values(session.pending)
        .filter((item) => !session.roleFilter || item.roleId === session.roleFilter)
        .sort((a, b) => a.startedAt - b.startedAt),
    [session.pending, session.roleFilter],
  )

  const pendingTextLength = pendings.reduce((sum, item) => sum + item.text.length, 0)

  const lastPlanIndex = useMemo(() => {
    let index = -1
    visibleMessages.forEach((message, i) => {
      if (message.kind === 'plan') index = i
    })
    return index
  }, [visibleMessages])

  const scrollToBottom = (smooth = false) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    session.setAutoScroll(true)
    session.clearUnread()
    setAtBottom(true)
  }

  useEffect(() => {
    if (!atBottom) return
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visibleMessages.length, pendingTextLength, session.tasks.length, atBottom])

  useEffect(() => {
    setAtBottom(true)
    requestAnimationFrame(() => scrollToBottom())
  }, [sessionId])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAtBottom(nearBottom)
    session.setAutoScroll(nearBottom)
  }

  const filterRole = roles.find((role) => role.id === session.roleFilter) ?? null
  const showEmpty = !sessionId
  const noProviders = providers.length === 0
  const noOrchestra = orchestras.length === 0
  const noProject = !projectId

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
        <span className="truncate text-[12px] text-dim">
          {session.session?.title
            ? session.session.title
            : orchestra
              ? `Сессия · ${orchestra.name}`
              : 'Новый запуск'}
        </span>
        {sessionId && (
          <>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor(session.status) }} />
            <span className="shrink-0 text-[11px]" style={{ color: statusColor(session.status) }}>
              {STATUS_LABELS[session.status] ?? session.status}
            </span>
            {session.reconnecting && <span className="text-[10px] text-warn">переподключение…</span>}
            <span className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[10px] text-faint">
              <span>
                ↑{formatTokens(session.tokensIn)} ↓{formatTokens(session.tokensOut)}
              </span>
              <span>{formatCost(session.cost)}</span>
            </span>
          </>
        )}
        {filterRole && (
          <button
            className="ml-2 inline-flex shrink-0 items-center gap-1 rounded bg-elevated px-1.5 py-0.5 text-[10px] text-dim"
            onClick={() => session.setRoleFilter(null)}
            title="Сбросить фильтр"
          >
            фильтр: {filterRole.name} ✕
          </button>
        )}
      </div>

      <div ref={scrollerRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        {showEmpty && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-[520px]">
              <Empty
                icon={Sparkles}
                title="Соберите оркестр и запустите задачу"
                description="Агенты будут читать и править файлы в выбранной папке, а вы увидите каждый шаг."
              />
              <div className="mt-2 space-y-1.5">
                <SetupStep
                  done={Boolean(projectId)}
                  icon={Network}
                  title="1. Подключить папку проекта"
                  testId="setup-step-project"
                  hint={projects.find((project) => project.id === projectId)?.name}
                  onClick={() => useAppStore.getState().selectProject(null)}
                />
                <SetupStep
                  done={!noProviders}
                  icon={Plug}
                  title="2. Настроить провайдера и модель"
                  testId="setup-step-providers"
                  hint={noProviders ? 'API-ключ и Base URL' : undefined}
                  onClick={() => {
                    setTab('providers')
                  }}
                />
                <SetupStep
                  done={!noOrchestra}
                  icon={Bot}
                  title="3. Собрать оркестр из ролей"
                  testId="setup-step-orchestra"
                  hint={orchestra?.name}
                  onClick={() => setTab('orchestras')}
                />
              </div>
              {(noProject || noProviders || noOrchestra) && (
                <div className="mt-4 rounded border border-border bg-panel px-3 py-2 text-[11px] leading-5 text-faint">
                  {noProject && <div>• Выберите папку проекта в верхней панели.</div>}
                  {noProviders && <div>• Провайдер настраивается во вкладке Providers в сайдбаре.</div>}
                  {noOrchestra && <div>• Минимум один оркестр нужен для запуска.</div>}
                  {!noProject && !noProviders && !noOrchestra && (
                    <div>• Готово — напишите задачу в поле ниже и нажмите «Запустить».</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!showEmpty && (
          <div className="mx-auto flex max-w-[860px] flex-col gap-2.5 px-4 py-4">
            {session.loading && (
              <div className="flex items-center gap-2 text-[12px] text-faint">
                <Spinner size={12} /> загружаю сессию…
              </div>
            )}
            {visibleMessages.map((message, index) => (
              <div key={message.id} className="space-y-2.5">
                <MessageCard message={message} />
                {index === lastPlanIndex && session.tasks.length > 0 && (
                  <TaskPlan tasks={session.tasks} collapsedByDefault={session.tasks.length > 8} />
                )}
              </div>
            ))}

            {pendings.map((pending) => {
              const role = memberRoles.find((item) => item.id === pending.roleId) ?? null
              return (
                <div key={pending.id} className="fade-in rounded-md border border-border bg-panel px-3.5 py-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <RoleBadge role={role} />
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                      печатает
                    </span>
                    <Spinner size={11} className="ml-auto" />
                  </div>
                  {pending.text ? (
                    <div className="cursor-blink">
                      <RichText content={pending.text} />
                    </div>
                  ) : (
                    <div className="text-[12px] text-faint">думает…</div>
                  )}
                </div>
              )
            })}

            {session.approvals.map((request) => (
              <ApprovalCard key={request.id} request={request} />
            ))}

            {!session.loading && visibleMessages.length === 0 && pendings.length === 0 && (
              <div className="py-10 text-center text-[12px] text-faint">
                {session.roleFilter ? 'У этого агента пока нет сообщений' : 'Сообщений пока нет'}
              </div>
            )}
            <div ref={bottomRef} className="h-1" />
          </div>
        )}
      </div>

      {!atBottom && (
        <button
          className="absolute bottom-[104px] left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1.5 text-[11px] text-dim shadow-none hover:text-primary"
          onClick={() => scrollToBottom(true)}
        >
          <ArrowDown size={12} />
          вниз{session.unread > 0 ? ` · ${session.unread}` : ''}
        </button>
      )}

      <InputBox />
    </div>
  )
}

function SetupStep({
  done,
  icon: Icon,
  title,
  hint,
  testId,
  onClick,
}: {
  done: boolean
  icon: typeof Plug
  title: string
  hint?: string
  testId?: string
  onClick: () => void
}) {
  return (
    <button
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2.5 rounded border px-3 py-2 text-left transition-colors',
        done ? 'border-border bg-panel' : 'border-border bg-elevated hover:bg-active',
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
          done ? 'bg-ok/15 text-ok' : 'bg-accent/10 text-accent',
        )}
      >
        <Icon size={13} />
      </span>
      <span className={cn('text-[12px]', done ? 'text-faint line-through decoration-border' : 'text-dim')}>{title}</span>
      {hint && <span className="ml-auto truncate text-[11px] text-faint">{hint}</span>}
    </button>
  )
}

import { useMemo } from 'react'
import { MessageSquare, Plus, Trash2 } from 'lucide-react'
import { api } from '../../api/client'
import { useAppStore } from '../../store/app'
import { cn, formatCost, formatTokens, relativeTime, STATUS_LABELS, statusColor } from '../../lib/utils'
import { Empty } from '../common/Empty'
import { Modal } from '../common/Modal'

export function SessionHistory() {
  const {
    sessions,
    sessionId,
    projectId,
    orchestras,
    selectSession,
    newSession,
    sessionHistoryOpen,
    setSessionHistoryOpen,
    refreshSessions,
    handleError,
    notify,
  } = useAppStore()

  const filtered = useMemo(
    () => (projectId ? sessions.filter((session) => session.project_id === projectId) : sessions),
    [sessions, projectId],
  )

  const remove = async (id: string) => {
    if (!window.confirm('Удалить сессию вместе с историей сообщений?')) return
    try {
      await api.sessions.remove(id)
      await refreshSessions()
      if (sessionId === id) newSession()
      notify('Сессия удалена', 'success')
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <Modal
      open={sessionHistoryOpen}
      onClose={() => setSessionHistoryOpen(false)}
      title="История сессий"
      subtitle="Продолжите прошлый запуск или начните новый"
      width={620}
      footer={
        <>
          <button
            className="btn mr-auto"
            onClick={() => {
              newSession()
              setSessionHistoryOpen(false)
            }}
          >
            <Plus size={12} /> Новый запуск
          </button>
          <button className="btn" onClick={() => setSessionHistoryOpen(false)}>
            Закрыть
          </button>
        </>
      }
    >
      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <Empty compact icon={MessageSquare} title="Сессий пока нет" description="Запустите первую задачу из поля ввода." />
        )}
        {filtered.map((session) => {
          const orchestra = orchestras.find((item) => item.id === session.orchestra_id)
          return (
            <div
              key={session.id}
              className={cn(
                'flex items-center gap-2 rounded border px-3 py-2',
                session.id === sessionId ? 'border-accent/50 bg-active' : 'border-border bg-panel',
              )}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  selectSession(session.id)
                  setSessionHistoryOpen(false)
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor(session.status) }} />
                  <span className="truncate text-[12px] text-primary">{session.title || 'Без названия'}</span>
                  <span className="shrink-0 text-[10px]" style={{ color: statusColor(session.status) }}>
                    {STATUS_LABELS[session.status] ?? session.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-3.5 text-[10px] text-faint">
                  <span>{orchestra?.name ?? 'оркестр удалён'}</span>
                  <span>·</span>
                  <span>{relativeTime(session.updated_at)}</span>
                  <span>·</span>
                  <span className="font-mono">
                    ↑{formatTokens(session.tokens_in)} ↓{formatTokens(session.tokens_out)} · {formatCost(session.cost)}
                  </span>
                </div>
              </button>
              <button className="icon-btn h-6 w-6 hover:text-danger" onClick={() => void remove(session.id)}>
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

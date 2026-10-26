import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  Flag,
  Info,
  ListTodo,
  MessageSquare,
  Minus,
  Pause,
  PenLine,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal as TerminalIcon,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { EventRecord } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { useSessionStore } from '../../store/session'
import { cn, formatTime } from '../../lib/utils'
import { Empty } from '../common/Empty'

type FilterKey = 'files' | 'shell' | 'agents' | 'errors'

const FILTERS: Array<{ key: FilterKey; label: string; match: (type: string) => boolean }> = [
  { key: 'files', label: 'файлы', match: (type) => type.startsWith('fs.') },
  { key: 'shell', label: 'shell', match: (type) => type === 'shell.exec' },
  {
    key: 'agents',
    label: 'агенты',
    match: (type) =>
      type.startsWith('agent.') || type.startsWith('task.') || type === 'plan.created' || type.startsWith('run.'),
  },
  { key: 'errors', label: 'ошибки', match: (type) => type === 'error' || type === 'warn' },
]

interface Row {
  event: EventRecord
  icon: typeof Plus
  color: string
  action: string
  target: string
  roleId: string | null
  roleName: string | null
  detail?: string
  ok?: boolean
}

function toRow(event: EventRecord): Row {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const roleName = typeof payload.role_name === 'string' ? payload.role_name : null
  const roleId = typeof payload.role_id === 'string' ? payload.role_id : null
  const target = String(payload.path ?? payload.command ?? payload.title ?? payload.message ?? payload.endpoint ?? '')
  const base = { event, roleId, roleName, target }
  switch (event.type) {
    case 'fs.create':
      return { ...base, icon: FilePlus2, color: 'var(--ok)', action: 'создал файл' }
    case 'fs.write':
      return { ...base, icon: PenLine, color: 'var(--warn)', action: 'изменил файл' }
    case 'fs.delete':
      return { ...base, icon: Minus, color: 'var(--danger)', action: 'удалил файл' }
    case 'fs.move':
      return {
        ...base,
        icon: ArrowRightLeft,
        color: 'var(--accent)',
        action: 'переместил',
        detail: payload.old_path ? `${String(payload.old_path)} → ${target}` : undefined,
      }
    case 'shell.exec':
      return {
        ...base,
        icon: TerminalIcon,
        color: payload.ok ? 'var(--ok)' : 'var(--danger)',
        action: 'выполнил',
        ok: Boolean(payload.ok),
        detail: `exit ${String(payload.code ?? '—')} · ${String(payload.duration_ms ?? '')} мс`,
      }
    case 'agent.start':
      return { ...base, icon: Play, color: 'var(--accent)', action: 'начал работу', target: String(payload.phase ?? '') }
    case 'agent.end':
      return {
        ...base,
        icon: payload.ok === false ? XCircle : Square,
        color: payload.ok === false ? 'var(--danger)' : 'var(--text-faint)',
        action: payload.ok === false ? 'завершил с ошибкой' : 'завершил',
        target: String(payload.error ?? payload.phase ?? ''),
      }
    case 'task.created':
      return { ...base, icon: ListTodo, color: 'var(--accent)', action: 'задача создана' }
    case 'task.done':
      return { ...base, icon: CheckCircle2, color: 'var(--ok)', action: 'задача выполнена' }
    case 'task.updated':
      return { ...base, icon: ListTodo, color: 'var(--text-dim)', action: `задача: ${String(payload.status ?? '')}` }
    case 'agent.message':
      return {
        ...base,
        icon: MessageSquare,
        color: 'var(--text-dim)',
        action: `сообщение (${String(payload.kind ?? '')})`,
        target: String(payload.content ?? '').slice(0, 160).replace(/\n/g, ' '),
      }
    case 'agent.tool_call':
      return {
        ...base,
        icon: Wrench,
        color: 'var(--warn)',
        action: 'вызов инструмента',
        target: String(payload.tool ?? ''),
        detail: String(payload.args ?? '').slice(0, 160),
      }
    case 'agent.tool_result':
      return {
        ...base,
        icon: Wrench,
        color: payload.ok === false ? 'var(--danger)' : 'var(--text-faint)',
        action: `результат ${String(payload.tool ?? '')}`,
        target: String(payload.output ?? '').slice(0, 160).replace(/\n/g, ' '),
      }
    case 'approval.request':
      return {
        ...base,
        icon: ShieldAlert,
        color: 'var(--warn)',
        action: 'запрос подтверждения',
        target: String(payload.tool ?? ''),
      }
    case 'approval.resolved':
      return {
        ...base,
        icon: ShieldCheck,
        color: payload.allowed ? 'var(--ok)' : 'var(--danger)',
        action: payload.allowed ? 'разрешено' : 'отклонено',
        target: '',
      }
    case 'plan.created':
      return { ...base, icon: Flag, color: 'var(--accent)', action: 'план раунда', target: String(payload.round ?? '') }
    case 'run.start':
      return { ...base, icon: Play, color: 'var(--accent)', action: 'запуск оркестра' }
    case 'run.end':
      return { ...base, icon: Square, color: 'var(--text-dim)', action: 'завершение', target: String(payload.status ?? '') }
    case 'error':
      return { ...base, icon: XCircle, color: 'var(--danger)', action: 'ошибка' }
    case 'warn':
      return { ...base, icon: AlertTriangle, color: 'var(--warn)', action: 'предупреждение' }
    case 'provider.request':
      return {
        ...base,
        icon: Eye,
        color: 'var(--text-faint)',
        action: `${String(payload.provider ?? '')} → ${String(payload.model ?? '')}`,
        target: String(payload.endpoint ?? ''),
        detail: `${String(payload.status)} · ${String(payload.latency_ms)} мс`,
      }
    default:
      return { ...base, icon: Info, color: 'var(--text-faint)', action: event.type, target: '' }
  }
}

export function EventLog() {
  const events = useSessionStore((state) => state.events)
  const roles = useAppStore((state) => state.roles)
  const [activeFilters, setActiveFilters] = useState<FilterKey[]>([])
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paused) return
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events.length, paused])

  const rows = useMemo(() => {
    const filtered = events
      .filter((event) => event.type !== 'agent.status' && event.type !== 'usage' && event.type !== 'agent.message')
      .filter((event) => {
        if (activeFilters.length === 0) return true
        return activeFilters.some((key) => FILTERS.find((filter) => filter.key === key)?.match(event.type))
      })
      .filter((event) => {
        if (!query.trim()) return true
        const haystack = `${event.type} ${JSON.stringify(event.payload)}`.toLowerCase()
        return haystack.includes(query.toLowerCase())
      })
    return filtered.map(toRow)
  }, [events, activeFilters, query])

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
  }

  const exportLog = () => {
    const blob = new Blob([rows.map((row) => JSON.stringify(row.event)).join('\n')], { type: 'application/x-ndjson' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `maestro-events-${Date.now()}.ndjson`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="relative z-10 flex shrink-0 items-center gap-1 border-b border-border px-2 py-1 pointer-events-auto">
        {FILTERS.map((filter) => (
          <button
            key={filter.key}
            data-testid={`filter-${filter.key}`}
            className={cn(
              'rounded px-2 py-0.5 text-[11px] transition-colors',
              activeFilters.includes(filter.key) ? 'bg-active text-primary' : 'text-faint hover:text-dim',
            )}
            onClick={() => toggleFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
        <div className="relative ml-2">
          <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            data-testid="events-search-input"
            aria-label="Поиск по событиям"
            className="h-6 w-[170px] min-w-[140px] rounded border border-border bg-base pl-6 pr-2 text-[11px] text-primary outline-none placeholder:text-faint focus:border-[#3a3a46]"
            placeholder="поиск по событиям…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            data-testid="log-pause-btn"
            className={cn('icon-btn h-6 w-6', paused && 'text-warn')}
            title={paused ? 'Продолжить автопрокрутку' : 'Пауза автопрокрутки'}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Pause size={12} /> : <EyeOff size={12} />}
          </button>
          <button
            data-testid="log-export-btn"
            className="icon-btn h-6 w-6"
            title="Экспорт лога"
            onClick={exportLog}
            disabled={rows.length === 0}
          >
            <Download size={12} />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]"
        onScroll={() => {
          /* autoscroll handled on render below */
        }}
      >
        {rows.length === 0 && (
          <Empty compact icon={Info} title="Событий пока нет" description="Действия агентов появятся здесь в реальном времени." />
        )}
        {rows.map((row) => {
          const role = roles.find((item) => item.id === row.roleId)
          const Icon = row.icon
          const isOpen = expanded === row.event.id
          return (
            <div key={row.event.id}>
              <button
                className="flex w-full items-center gap-2 px-3 py-[3px] text-left hover:bg-elevated"
                onClick={() => setExpanded(isOpen ? null : row.event.id)}
              >
                <span className="shrink-0 text-faint">{formatTime(row.event.created_at)}</span>
                <Icon size={11} className="shrink-0" style={{ color: row.color }} />
                <span
                  className="w-[110px] shrink-0 truncate text-[11px]"
                  style={{ color: role?.color ?? 'var(--text-dim)' }}
                >
                  {row.roleName ?? 'система'}
                </span>
                <span className="shrink-0 text-faint">{row.action}</span>
                <span className="min-w-0 flex-1 truncate text-dim" title={row.target}>
                  {row.detail && row.event.type === 'fs.move' ? row.detail : row.target}
                </span>
                {row.event.type === 'shell.exec' && (
                  <span style={{ color: row.ok ? 'var(--ok)' : 'var(--danger)' }} className="shrink-0">
                    [{row.ok ? 'ok' : 'fail'}]
                  </span>
                )}
              </button>
              {isOpen && (
                <pre className="mx-3 mb-1 max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-base px-2 py-1.5 text-[10px] leading-4 text-faint">
                  {JSON.stringify(row.event.payload, null, 2)}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

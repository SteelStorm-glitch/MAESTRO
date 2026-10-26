import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDashed, Loader2, SkipForward, XCircle } from 'lucide-react'
import type { Task } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn, STATUS_LABELS } from '../../lib/utils'
import { RoleBadge } from '../common/Badge'

const STATUS_ICON = {
  pending: Circle,
  running: Loader2,
  done: CheckCircle2,
  failed: XCircle,
  skipped: SkipForward,
} as const

const STATUS_COLOR: Record<Task['status'], string> = {
  pending: 'var(--text-faint)',
  running: 'var(--accent)',
  done: 'var(--ok)',
  failed: 'var(--danger)',
  skipped: 'var(--text-faint)',
}

export function TaskPlan({ tasks, collapsedByDefault = false }: { tasks: Task[]; collapsedByDefault?: boolean }) {
  const roles = useAppStore((state) => state.roles)
  const [open, setOpen] = useState(!collapsedByDefault)
  if (tasks.length === 0) return null
  const done = tasks.filter((task) => task.status === 'done').length
  const failed = tasks.filter((task) => task.status === 'failed').length

  return (
    <div className="rounded-md border border-border bg-panel">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={13} className="text-faint" /> : <ChevronRight size={13} className="text-faint" />}
        <span className="text-[12px] font-medium text-primary">План работ</span>
        <span className="text-[11px] text-faint">
          {done}/{tasks.length} готово{failed ? ` · ${failed} с ошибкой` : ''}
        </span>
        <div className="ml-auto h-1 w-24 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-ok transition-all"
            style={{ width: `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%` }}
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {tasks.map((task) => {
            const Icon = STATUS_ICON[task.status] ?? CircleDashed
            const role = roles.find((item) => item.id === task.assigned_role_id) ?? null
            return (
              <div key={task.id} className="flex items-start gap-2 py-1.5">
                <Icon
                  size={13}
                  className={cn('mt-[2px] shrink-0', task.status === 'running' && 'animate-spin')}
                  style={{ color: STATUS_COLOR[task.status] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'truncate text-[12px]',
                        task.status === 'done' ? 'text-faint line-through decoration-border' : 'text-dim',
                      )}
                    >
                      {task.title}
                    </span>
                    {role && <RoleBadge role={role} size="sm" />}
                  </div>
                  {task.result && task.status !== 'pending' && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-faint">{task.result}</div>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-faint">{STATUS_LABELS[task.status] ?? task.status}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

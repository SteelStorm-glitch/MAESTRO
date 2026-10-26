import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  FolderOpen,
  History,
  Pause,
  Play,
  Plus,
  Square,
  Workflow,
} from 'lucide-react'
import { useAppStore } from '../store/app'
import { useSessionStore } from '../store/session'
import { cn, STATUS_LABELS, statusColor } from '../lib/utils'
import { SessionHistory } from './session/SessionHistory'

export function TopBar() {
  const {
    projects,
    projectId,
    orchestras,
    orchestraId,
    selectProject,
    selectOrchestra,
    setSessionHistoryOpen,
    openOrchestraBuilder,
    serverOnline,
    setProjectDialogOpen,
  } = useAppStore()
  const { sessionId, status, pause, resume, cancel } = useSessionStore()
  const [menu, setMenu] = useState<'project' | 'orchestra' | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const project = projects.find((item) => item.id === projectId) ?? null
  const orchestra = orchestras.find((item) => item.id === orchestraId) ?? null

  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const focusInput = () => {
    const textarea = document.querySelector('textarea')
    textarea?.focus()
  }

  const running = status === 'running'
  const paused = status === 'paused'

  return (
    <div ref={barRef} className="relative z-30 flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-1.5 pr-2">
        <span className="text-[15px] leading-none text-accent">◆</span>
        <span className="text-[12px] font-semibold tracking-[0.12em] text-primary">MAESTRO</span>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="relative">
        <button
          data-testid="topbar-project-select"
          className="flex h-7 max-w-[240px] items-center gap-1.5 rounded px-2 text-[12px] text-dim hover:bg-elevated hover:text-primary"
          onClick={() => setMenu(menu === 'project' ? null : 'project')}
          title={project?.root_path}
        >
          <FolderOpen size={13} className="text-faint" />
          <span className="truncate">{project?.name ?? 'выбрать папку'}</span>
          <ChevronDown size={12} className="shrink-0 text-faint" />
        </button>
        {menu === 'project' && (
          <div className="fade-in absolute left-0 top-[34px] z-40 w-[300px] rounded-md border border-border bg-elevated py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-faint">Проекты</div>
            {projects.map((item) => (
              <button
                key={item.id}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-active',
                  item.id === projectId && 'bg-active/60',
                )}
                onClick={() => {
                  selectProject(item.id)
                  setMenu(null)
                }}
              >
                <FolderOpen size={12} className="mt-1 shrink-0 text-faint" />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-primary">{item.name}</span>
                  <span className="block truncate text-[10px] text-faint" title={item.root_path}>
                    {item.root_path}
                  </span>
                </span>
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-accent hover:bg-active"
              onClick={() => {
                setMenu(null)
                setProjectDialogOpen(true)
              }}
            >
              <Plus size={12} /> Подключить папку…
            </button>
          </div>
        )}
      </div>

      <span className="text-faint">▸</span>

      <div className="relative">
        <button
          data-testid="topbar-orchestra-select"
          className="flex h-7 max-w-[220px] items-center gap-1.5 rounded px-2 text-[12px] text-dim hover:bg-elevated hover:text-primary"
          onClick={() => setMenu(menu === 'orchestra' ? null : 'orchestra')}
        >
          <Workflow size={13} className="text-faint" />
          <span className="truncate">{orchestra?.name ?? 'нет оркестра'}</span>
          <ChevronDown size={12} className="shrink-0 text-faint" />
        </button>
        {menu === 'orchestra' && (
          <div className="fade-in absolute left-0 top-[34px] z-40 w-[260px] rounded-md border border-border bg-elevated py-1">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-faint">Оркестры</div>
            {orchestras.map((item) => (
              <button
                key={item.id}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-active',
                  item.id === orchestraId ? 'bg-active/60 text-primary' : 'text-dim',
                )}
                onClick={() => {
                  selectOrchestra(item.id)
                  setMenu(null)
                }}
              >
                <Workflow size={12} className="shrink-0 text-faint" />
                <span className="truncate">{item.name}</span>
                <span className="ml-auto text-[9px] text-faint">{item.strategy}</span>
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-accent hover:bg-active"
              onClick={() => {
                setMenu(null)
                openOrchestraBuilder('new')
              }}
            >
              <Plus size={12} /> Создать оркестр…
            </button>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {sessionId && (
          <span
            className="mr-1 flex items-center gap-1.5 rounded px-2 py-1 text-[11px]"
            style={{ color: statusColor(status), background: `${statusColor(status)}12` }}
          >
            <span
              className={cn('h-1.5 w-1.5 rounded-full', running && 'pulse-dot')}
              style={{ background: statusColor(status) }}
            />
            {STATUS_LABELS[status] ?? status}
          </span>
        )}

        {paused && (
          <button className="icon-btn" title="Продолжить" onClick={() => void resume()}>
            <Play size={14} />
          </button>
        )}
        {running && (
          <button className="icon-btn" title="Пауза" onClick={() => void pause()}>
            <Pause size={14} />
          </button>
        )}
        {sessionId && (running || paused) && (
          <button className="icon-btn hover:text-danger" title="Остановить" onClick={() => void cancel()}>
            <Square size={13} />
          </button>
        )}

        <button
          data-testid="topbar-run"
          className="btn btn-primary h-7 px-2.5"
          onClick={focusInput}
          title="Написать задачу"
        >
          <Play size={12} />
          Run
        </button>

        <button
          data-testid="topbar-history"
          className="icon-btn ml-1"
          title="История сессий"
          onClick={() => setSessionHistoryOpen(true)}
        >
          <History size={15} />
        </button>
        <button
          data-testid="topbar-new-session"
          className="icon-btn"
          title="Новая сессия"
          onClick={() => useAppStore.getState().newSession()}
        >
          <Plus size={15} />
        </button>
        <span
          className={cn('ml-1 h-1.5 w-1.5 rounded-full', serverOnline ? 'bg-ok' : 'bg-danger')}
          title={serverOnline ? 'сервер онлайн' : 'сервер недоступен'}
        />
        <span className="hidden text-[10px] text-faint min-[1380px]:inline">
          {serverOnline ? 'server: ok' : 'server: down'}
        </span>
      </div>

      <SessionHistory />
    </div>
  )
}

import { useState } from 'react'
import { ChevronDown, ListTree, Network, TerminalSquare } from 'lucide-react'
import { useSessionStore } from '../../store/session'
import { cn } from '../../lib/utils'
import { EventLog } from './EventLog'
import { RequestLog } from './RequestLog'
import { TerminalPanel } from './Terminal'

type ConsoleTab = 'events' | 'terminal' | 'requests'

const TABS: Array<{ key: ConsoleTab; label: string; icon: typeof ListTree }> = [
  { key: 'events', label: 'События', icon: ListTree },
  { key: 'terminal', label: 'Терминал', icon: TerminalSquare },
  { key: 'requests', label: 'Запросы', icon: Network },
]

export function ConsolePanel({ onCollapse }: { onCollapse?: () => void }) {
  const [tab, setTab] = useState<ConsoleTab>('events')
  const eventsCount = useSessionStore((state) => state.events.length)
  const requestsCount = useSessionStore((state) => state.requests.length)

  return (
    <div className="relative z-20 flex h-full flex-col border-t border-border bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        {TABS.map((item) => {
          const Icon = item.icon
          const count = item.key === 'events' ? eventsCount : item.key === 'requests' ? requestsCount : null
          return (
            <button
              key={item.key}
              data-testid={`console-tab-${item.key}`}
              className={cn(
                'flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors',
                tab === item.key ? 'bg-active text-primary' : 'text-faint hover:text-dim',
              )}
              onClick={() => setTab(item.key)}
            >
              <Icon size={12} />
              {item.label}
              {count !== null && count > 0 && (
                <span className="rounded bg-border px-1 py-[1px] font-mono text-[9px] text-dim">{count}</span>
              )}
            </button>
          )
        })}
        <button className="icon-btn ml-auto h-6 w-6" title="Свернуть панель" onClick={onCollapse}>
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <div className={cn('h-full', tab !== 'events' && 'hidden')}>
          <EventLog />
        </div>
        {tab === 'terminal' && (
          <div className="h-full">
            <TerminalPanel />
          </div>
        )}
        <div className={cn('h-full', tab !== 'requests' && 'hidden')}>
          <RequestLog />
        </div>
      </div>
    </div>
  )
}

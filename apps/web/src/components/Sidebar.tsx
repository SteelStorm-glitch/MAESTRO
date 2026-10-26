import { FolderTree, Plug, Users, Workflow } from 'lucide-react'
import { useAppStore, type SidebarTab } from '../store/app'
import { cn } from '../lib/utils'
import { FileTree } from './files/FileTree'
import { OrchestraList } from './orchestras/OrchestraList'
import { ProviderList } from './providers/ProviderList'
import { RoleList } from './roles/RoleList'

const TABS: Array<{ key: SidebarTab; label: string; icon: typeof FolderTree }> = [
  { key: 'files', label: 'Files', icon: FolderTree },
  { key: 'orchestras', label: 'Orchestras', icon: Workflow },
  { key: 'roles', label: 'Roles', icon: Users },
  { key: 'providers', label: 'Providers', icon: Plug },
]

export function Sidebar() {
  const tab = useAppStore((state) => state.tab)
  const setTab = useAppStore((state) => state.setTab)

  return (
    <div className="flex h-full flex-col border-r border-border bg-panel">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border">
        {TABS.map((item) => {
          const Icon = item.icon
          const active = tab === item.key
          return (
            <button
              key={item.key}
              data-testid={`sidebar-tab-${item.key}`}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 text-[10px] transition-colors',
                active ? 'bg-base text-primary' : 'text-faint hover:bg-elevated hover:text-dim',
              )}
              title={item.label}
              onClick={() => setTab(item.key)}
            >
              <Icon size={12} className={active ? 'text-accent' : undefined} />
              <span className="hidden min-[1400px]:inline">{item.label}</span>
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1">
        <div className={cn('h-full', tab !== 'files' && 'hidden')}>
          <FileTree />
        </div>
        {tab === 'orchestras' && (
          <div className="h-full">
            <OrchestraList />
          </div>
        )}
        {tab === 'roles' && (
          <div className="h-full">
            <RoleList />
          </div>
        )}
        {tab === 'providers' && (
          <div className="h-full">
            <ProviderList />
          </div>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Plus, ShieldCheck, Users } from 'lucide-react'
import type { Role } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { Empty } from '../common/Empty'
import { RoleEditor } from './RoleEditor'

export function RoleList() {
  const { roles, models, providers } = useAppStore()
  const [editing, setEditing] = useState<Role | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="px-1 text-[11px] uppercase tracking-wide text-faint">Роли</span>
        <span className="text-[10px] text-faint">{roles.length}</span>
        <button
          className="icon-btn ml-auto text-accent"
          title="Новая роль"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {roles.length === 0 && (
          <Empty
            compact
            icon={Users}
            title="Нет ролей"
            description="Роль — это агент с промптом, моделью и правами."
            action={
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditing(null)
                  setOpen(true)
                }}
              >
                Создать роль
              </button>
            }
          />
        )}
        {roles.map((role) => {
          const model = models.find((item) => item.id === role.model_id) ?? null
          const provider = providers.find((item) => item.id === model?.provider_id) ?? null
          return (
            <button
              key={role.id}
              data-testid={`role-card-${role.id}`}
              className="mb-1.5 w-full rounded border border-border bg-panel px-2.5 py-2 text-left transition-colors hover:bg-elevated"
              onClick={() => {
                setEditing(role)
                setOpen(true)
              }}
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: role.color }} />
                <span className="truncate text-[12px] text-primary">{role.name}</span>
                <span className="ml-auto shrink-0 rounded bg-elevated px-1 py-[1px] text-[9px] uppercase text-faint">
                  {role.permission}
                </span>
              </div>
              <div className="mt-0.5 truncate pl-4 text-[10px] text-faint">
                {model ? `${model.display_name}${provider ? ` · ${provider.name}` : ''}` : 'модель не выбрана'}
              </div>
              {role.description && (
                <div className="mt-0.5 line-clamp-2 pl-4 text-[10px] leading-4 text-faint">{role.description}</div>
              )}
              {role.shell_mode !== 'off' && (
                <div className="mt-1 flex items-center gap-1 pl-4 text-[9px] text-warn">
                  <ShieldCheck size={9} /> shell: {role.shell_mode}
                </div>
              )}
            </button>
          )
        })}
      </div>

      <RoleEditor open={open} role={editing} onClose={() => setOpen(false)} />
    </div>
  )
}

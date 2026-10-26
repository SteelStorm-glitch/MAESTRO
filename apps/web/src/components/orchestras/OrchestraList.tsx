import { useEffect, useRef, useState } from 'react'
import { Crown, Plus, Upload, Workflow } from 'lucide-react'
import type { Orchestra } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn } from '../../lib/utils'
import { Empty } from '../common/Empty'
import { OrchestraBuilder } from './OrchestraBuilder'

export function OrchestraList() {
  const {
    orchestras,
    roles,
    orchestraId,
    orchestraDraftId,
    selectOrchestra,
    importOrchestra,
    openOrchestraBuilder,
    handleError,
    notify,
  } = useAppStore()
  const [editing, setEditing] = useState<Orchestra | null>(null)
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!orchestraDraftId) return
    if (orchestraDraftId === 'new') setEditing(null)
    else setEditing(orchestras.find((item) => item.id === orchestraDraftId) ?? null)
    setOpen(true)
    openOrchestraBuilder(null)
  }, [orchestraDraftId, orchestras, openOrchestraBuilder])

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      await importOrchestra(data)
      notify('Оркестр импортирован', 'success')
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="px-1 text-[11px] uppercase tracking-wide text-faint">Оркестры</span>
        <span className="text-[10px] text-faint">{orchestras.length}</span>
        <button className="icon-btn ml-auto" title="Импорт оркестра из JSON" onClick={() => fileRef.current?.click()}>
          <Upload size={13} />
        </button>
        <button
          className="icon-btn text-accent"
          title="Новый оркестр"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
            event.target.value = ''
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {orchestras.length === 0 && (
          <Empty
            compact
            icon={Workflow}
            title="Оркестров нет"
            description="Соберите команду из ролей и выберите стратегию."
            action={
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditing(null)
                  setOpen(true)
                }}
              >
                Создать оркестр
              </button>
            }
          />
        )}
        {orchestras.map((orchestra) => {
          const conductor = roles.find((role) => role.id === orchestra.conductor_role_id)
          const active = orchestraId === orchestra.id
          return (
            <button
              key={orchestra.id}
              className={cn(
                'mb-1.5 w-full rounded border px-2.5 py-2 text-left transition-colors',
                active ? 'border-accent/50 bg-active' : 'border-border bg-panel hover:bg-elevated',
              )}
              onClick={() => {
                selectOrchestra(orchestra.id)
                setEditing(orchestra)
                setOpen(true)
              }}
            >
              <div className="flex items-center gap-2">
                <Workflow size={12} className={active ? 'text-accent' : 'text-faint'} />
                <span className="truncate text-[12px] text-primary">{orchestra.name}</span>
                <span className="ml-auto chip shrink-0">{orchestra.strategy}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-5 text-[10px] text-faint">
                <span>{orchestra.members.length} ролей</span>
                {conductor && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Crown size={9} /> {conductor.name}
                    </span>
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <OrchestraBuilder open={open} orchestra={editing} onClose={() => setOpen(false)} />
    </div>
  )
}

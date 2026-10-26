import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Model, Provider } from '@maestro/shared'
import { api } from '../../api/client'
import { useAppStore } from '../../store/app'
import { cn, formatTokens } from '../../lib/utils'

function Toggle({
  value,
  onChange,
  title,
}: {
  value: boolean
  onChange: (value: boolean) => void
  title?: string
}) {
  return (
    <button
      className={cn(
        'relative h-[16px] w-[28px] rounded-full transition-colors',
        value ? 'bg-accent' : 'bg-border',
      )}
      title={title}
      onClick={() => onChange(!value)}
    >
      <span
        className={cn(
          'absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-transform',
          value ? 'translate-x-[14px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  )
}

export function ModelTable({
  provider,
  models,
  onChanged,
}: {
  provider: Provider
  models: Model[]
  onChanged: () => void
}) {
  const { handleError, notify } = useAppStore()
  const [adding, setAdding] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newContext, setNewContext] = useState(128000)
  const [busy, setBusy] = useState<string | null>(null)

  const update = async (model: Model, patch: Partial<Model>) => {
    setBusy(model.id)
    try {
      await api.models.update(model.id, {
        display_name: patch.display_name,
        context_window: patch.context_window,
        max_output: patch.max_output,
        supports_tools: patch.supports_tools,
        supports_vision: patch.supports_vision,
        enabled: patch.enabled,
      })
      onChanged()
    } catch (error) {
      handleError(error)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (model: Model) => {
    if (!window.confirm(`Удалить модель «${model.display_name}»?`)) return
    try {
      await api.models.remove(model.id)
      onChanged()
      void useAppStore.getState().refreshRoles()
    } catch (error) {
      handleError(error)
    }
  }

  const add = async () => {
    if (!newModelId.trim()) return
    try {
      await api.models.create({
        provider_id: provider.id,
        model_id: newModelId.trim(),
        display_name: newDisplayName.trim() || newModelId.trim(),
        context_window: newContext,
        max_output: Math.min(8192, Math.floor(newContext / 8)),
      })
      setNewModelId('')
      setNewDisplayName('')
      setAdding(false)
      onChanged()
      notify('Модель добавлена', 'success')
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <div>
      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_86px_86px_54px_54px_54px_30px] gap-2 px-1 text-[10px] uppercase tracking-wide text-faint">
        <span>модель</span>
        <span>context</span>
        <span>max out</span>
        <span>вкл</span>
        <span>tools</span>
        <span>vision</span>
        <span />
      </div>
      <div className="overflow-hidden rounded border border-border">
        {models.length === 0 && (
          <div className="px-3 py-5 text-center text-[11px] text-faint">
            Моделей нет. Нажмите «Загрузить модели» или добавьте вручную.
          </div>
        )}
        {models.map((model) => (
          <div
            key={model.id}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_86px_86px_54px_54px_54px_30px] items-center gap-2 border-b border-border px-2 py-1.5 last:border-b-0',
              busy === model.id && 'opacity-60',
            )}
          >
            <div className="min-w-0">
              <div className="truncate text-[12px] text-primary" title={model.display_name}>
                {model.display_name}
              </div>
              <div className="truncate font-mono text-[10px] text-faint">{model.model_id}</div>
            </div>
            <input
              key={`ctx-${model.id}-${model.context_window}`}
              className="h-6 w-full rounded border border-transparent bg-transparent px-1 font-mono text-[11px] text-dim outline-none hover:border-border focus:border-[#3a3a46] focus:text-primary"
              defaultValue={model.context_window}
              title={`${formatTokens(model.context_window)} токенов`}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value > 0 && value !== model.context_window) {
                  void update(model, { ...model, context_window: Math.round(value) })
                }
              }}
            />
            <input
              key={`out-${model.id}-${model.max_output}`}
              className="h-6 w-full rounded border border-transparent bg-transparent px-1 font-mono text-[11px] text-dim outline-none hover:border-border focus:border-[#3a3a46] focus:text-primary"
              defaultValue={model.max_output}
              onBlur={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value) && value > 0 && value !== model.max_output) {
                  void update(model, { ...model, max_output: Math.round(value) })
                }
              }}
            />
            <Toggle value={model.enabled} onChange={(value) => void update(model, { ...model, enabled: value })} title="Модель доступна" />
            <Toggle
              value={model.supports_tools}
              onChange={(value) => void update(model, { ...model, supports_tools: value })}
              title="Поддержка function calling"
            />
            <Toggle
              value={model.supports_vision}
              onChange={(value) => void update(model, { ...model, supports_vision: value })}
              title="Поддержка изображений"
            />
            <button className="icon-btn h-6 w-6 hover:text-danger" title="Удалить" onClick={() => void remove(model)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="mt-2 rounded border border-border bg-elevated p-2">
          <div className="grid grid-cols-[1fr_1fr_110px] gap-2">
            <input
              autoFocus
              className="input h-7 font-mono text-[11px]"
              placeholder="model_id, например deepseek-chat"
              value={newModelId}
              onChange={(event) => setNewModelId(event.target.value)}
            />
            <input
              className="input h-7 text-[11px]"
              placeholder="Отображаемое имя"
              value={newDisplayName}
              onChange={(event) => setNewDisplayName(event.target.value)}
            />
            <input
              className="input h-7 font-mono text-[11px]"
              type="number"
              value={newContext}
              onChange={(event) => setNewContext(Number(event.target.value))}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button className="btn h-6 text-[11px]" onClick={() => setAdding(false)}>
              Отмена
            </button>
            <button className="btn btn-primary h-6 text-[11px]" onClick={() => void add()} disabled={!newModelId.trim()}>
              Добавить
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-ghost mt-2 h-6 px-1.5 text-[11px]" onClick={() => setAdding(true)}>
          <Plus size={11} /> добавить модель вручную
        </button>
      )}
    </div>
  )
}

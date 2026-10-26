import { useRef, useState } from 'react'
import { Download, Pencil, Plug, Plus, Upload } from 'lucide-react'
import type { Provider } from '@maestro/shared'
import { api } from '../../api/client'
import { useAppStore } from '../../store/app'
import { cn } from '../../lib/utils'
import { Empty } from '../common/Empty'
import { ProviderDetail } from './ProviderDetail'
import { ProviderDialog } from './ProviderDialog'

export function ProviderList() {
  const { providers, models, providerHealth, handleError, notify, refreshAll } = useAppStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [detail, setDetail] = useState<Provider | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportProviders = async () => {
    try {
      const data = await api.providers.exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'maestro-providers.json'
      link.click()
      URL.revokeObjectURL(url)
      notify('Провайдеры экспортированы (без ключей)', 'success')
    } catch (error) {
      handleError(error)
    }
  }

  const importProviders = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text())
      const result = await api.providers.importAll(raw)
      await refreshAll()
      notify(`Импортировано провайдеров: ${result.imported}. Укажите API-ключи.`, 'success')
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="px-1 text-[11px] uppercase tracking-wide text-faint">Провайдеры</span>
        <button
          className="icon-btn ml-auto"
          title="Экспорт (без ключей)"
          onClick={() => void exportProviders()}
          disabled={providers.length === 0}
        >
          <Download size={13} />
        </button>
        <button className="icon-btn" title="Импорт из JSON" onClick={() => fileRef.current?.click()}>
          <Upload size={13} />
        </button>
        <button
          data-testid="add-provider-btn"
          className="icon-btn text-accent"
          title="Добавить провайдера"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importProviders(file)
            event.target.value = ''
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {providers.length === 0 && (
          <Empty
            compact
            icon={Plug}
            title="Нет провайдеров"
            description="Добавьте API-ключ и Base URL — OpenAI, DeepSeek, OpenRouter, Ollama…"
            action={
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditing(null)
                  setDialogOpen(true)
                }}
              >
                Добавить
              </button>
            }
          />
        )}
        {providers.map((provider) => {
          const count = models.filter((model) => model.provider_id === provider.id).length
          const health = providerHealth[provider.id]
          return (
            <div
              key={provider.id}
              className="group mb-1.5 cursor-pointer rounded border border-border bg-panel px-2.5 py-2 transition-colors hover:bg-elevated"
              onClick={() => setDetail(provider)}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    health ? (health.ok ? 'bg-ok' : 'bg-danger') : 'bg-[#33333b]',
                  )}
                  title={health ? (health.ok ? 'соединение ok' : health.error) : 'не проверялся'}
                />
                <span className="truncate text-[12px] text-primary">{provider.name}</span>
                <button
                  className="icon-btn ml-auto h-5 w-5 opacity-0 group-hover:opacity-100"
                  title="Изменить"
                  onClick={(event) => {
                    event.stopPropagation()
                    setEditing(provider)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil size={11} />
                </button>
              </div>
              <div className="mt-0.5 truncate pl-4 text-[10px] text-faint">
                {provider.protocol} · {count} моделей
              </div>
              <div className="truncate pl-4 font-mono text-[10px] text-faint" title={provider.base_url}>
                {provider.base_url}
              </div>
            </div>
          )
        })}
      </div>

      <ProviderDialog
        open={dialogOpen}
        provider={editing}
        onClose={() => {
          setDialogOpen(false)
          setEditing(null)
        }}
      />
      {detail && (
        <ProviderDetail
          provider={providers.find((item) => item.id === detail.id) ?? detail}
          onClose={() => setDetail(null)}
          onEdit={(provider) => {
            setDetail(null)
            setEditing(provider)
            setDialogOpen(true)
          }}
        />
      )}
    </div>
  )
}

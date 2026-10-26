import { useState } from 'react'
import { DownloadCloud, Pencil, RefreshCw, Trash2, Wifi } from 'lucide-react'
import type { Provider, RemoteModel } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn, formatTokens } from '../../lib/utils'
import { Modal } from '../common/Modal'
import { Spinner } from '../common/Spinner'
import { ModelTable } from './ModelTable'

export function ProviderDetail({
  provider,
  onClose,
  onEdit,
}: {
  provider: Provider | null
  onClose: () => void
  onEdit: (provider: Provider) => void
}) {
  const {
    models,
    providerHealth,
    refreshModels,
    testProvider,
    fetchRemoteModels,
    importRemoteModels,
    deleteProvider,
    handleError,
    notify,
  } = useAppStore()
  const [testing, setTesting] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [remoteModels, setRemoteModels] = useState<RemoteModel[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  if (!provider) return null
  const providerModels = models.filter((model) => model.provider_id === provider.id)
  const health = providerHealth[provider.id]

  const test = async () => {
    setTesting(true)
    try {
      const result = await testProvider(provider.id)
      notify(
        result.ok ? `Соединение OK · ${result.latencyMs} мс` : `Ошибка: ${result.error ?? 'неизвестно'}`,
        result.ok ? 'success' : 'error',
      )
    } catch (error) {
      handleError(error)
    } finally {
      setTesting(false)
    }
  }

  const fetchModels = async () => {
    setFetching(true)
    try {
      const list = await fetchRemoteModels(provider.id)
      setRemoteModels(list)
      const existing = new Set(providerModels.map((model) => model.model_id))
      setSelected(new Set(list.filter((model) => !existing.has(model.id)).map((model) => model.id)))
      if (list.length === 0) notify('Провайдер вернул пустой список моделей', 'info')
    } catch (error) {
      handleError(error)
    } finally {
      setFetching(false)
    }
  }

  const importSelected = async () => {
    if (!remoteModels) return
    const chosen = remoteModels.filter((model) => selected.has(model.id))
    if (chosen.length === 0) return
    setImporting(true)
    try {
      await importRemoteModels(provider.id, chosen)
      notify(`Импортировано моделей: ${chosen.length}`, 'success')
      setRemoteModels(null)
      setSelected(new Set())
    } catch (error) {
      handleError(error)
    } finally {
      setImporting(false)
    }
  }

  const removeProvider = async () => {
    if (!window.confirm(`Удалить провайдера «${provider.name}» вместе со всеми моделями?`)) return
    try {
      await deleteProvider(provider.id)
      notify('Провайдер удалён', 'success')
      onClose()
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={provider.name}
      subtitle={`${provider.protocol} · ${provider.base_url}`}
      footer={
        <>
          <button className="btn btn-danger mr-auto" onClick={() => void removeProvider()}>
            <Trash2 size={12} /> Удалить
          </button>
          <button className="btn" onClick={() => onEdit(provider)}>
            <Pencil size={12} /> Изменить
          </button>
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? <Spinner size={12} /> : <Wifi size={12} />} Test connection
          </button>
          <button className="btn btn-primary" onClick={() => void fetchModels()} disabled={fetching}>
            {fetching ? <Spinner size={12} className="text-current" /> : <DownloadCloud size={12} />}
            Загрузить модели
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="chip">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', health ? (health.ok ? 'bg-ok' : 'bg-danger') : 'bg-faint')}
            />
            {health ? (health.ok ? `online · ${health.latencyMs} мс` : 'ошибка соединения') : 'не проверялся'}
          </span>
          <span className="chip">моделей: {providerModels.length}</span>
          <span className="chip">таймаут: {provider.timeout_ms} мс</span>
          <span className="chip">ключ: {provider.key_masked ?? 'не задан'}</span>
          {health?.error && <span className="text-danger">{health.error}</span>}
        </div>

        {remoteModels && (
          <div className="rounded border border-border bg-elevated">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="text-[12px] font-medium text-primary">Модели провайдера</span>
              <span className="text-[11px] text-faint">{remoteModels.length} найдено</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="btn btn-ghost h-6 px-1.5 text-[11px]"
                  onClick={() =>
                    setSelected(
                      selected.size === remoteModels.length ? new Set() : new Set(remoteModels.map((model) => model.id)),
                    )
                  }
                >
                  {selected.size === remoteModels.length ? 'снять все' : 'выбрать все'}
                </button>
                <button
                  className="btn btn-primary h-6 text-[11px]"
                  disabled={selected.size === 0 || importing}
                  onClick={() => void importSelected()}
                >
                  {importing ? <Spinner size={11} className="text-current" /> : null}
                  Добавить ({selected.size})
                </button>
                <button className="btn h-6 text-[11px]" onClick={() => setRemoteModels(null)}>
                  Закрыть
                </button>
              </div>
            </div>
            <div className="max-h-[220px] overflow-y-auto px-2 py-1">
              {remoteModels.map((model) => (
                <label
                  key={model.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12px] hover:bg-active"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(model.id)}
                    onChange={(event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(model.id)
                      else next.delete(model.id)
                      setSelected(next)
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-dim">{model.id}</span>
                  {model.context_window && (
                    <span className="text-[10px] text-faint">{formatTokens(model.context_window)} ctx</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        <ModelTable provider={provider} models={providerModels} onChanged={() => void refreshModels()} />

        <div className="flex items-center gap-2 text-[10px] text-faint">
          <RefreshCw size={10} />
          Изменения контекста и флагов применяются сразу.
        </div>
      </div>
    </Modal>
  )
}

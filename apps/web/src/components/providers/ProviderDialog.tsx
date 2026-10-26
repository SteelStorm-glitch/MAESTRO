import { useEffect, useState } from 'react'
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import type { ExtraHeader, Provider, ProviderProtocol } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn } from '../../lib/utils'
import { Modal } from '../common/Modal'
import { Spinner } from '../common/Spinner'

const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  'openai-compatible': 'OpenAI-compatible',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
}

const PROTOCOL_HINTS: Record<ProviderProtocol, string> = {
  'openai-compatible': 'https://api.deepseek.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
}

export function ProviderDialog({
  open,
  provider,
  onClose,
}: {
  open: boolean
  provider: Provider | null
  onClose: () => void
}) {
  const { saveProvider, testProvider, notify, handleError } = useAppStore()
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<ProviderProtocol>('openai-compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const [timeout, setTimeoutValue] = useState(120000)
  const [headers, setHeaders] = useState<ExtraHeader[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(provider?.name ?? '')
    setProtocol(provider?.protocol ?? 'openai-compatible')
    setBaseUrl(provider?.base_url ?? PROTOCOL_HINTS[provider?.protocol ?? 'openai-compatible'])
    setApiKey('')
    setShowKey(false)
    setClearKey(false)
    setTimeoutValue(provider?.timeout_ms ?? 120000)
    setHeaders(provider?.extra_headers ?? [])
    setTestResult(null)
    setError(null)
  }, [open, provider])

  const save = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Укажите имя провайдера')
      return
    }
    if (!/^https?:\/\//i.test(baseUrl.trim())) {
      setError('Base URL должен начинаться с http:// или https://')
      return
    }
    setSaving(true)
    try {
      await saveProvider(
        {
          name: name.trim(),
          protocol,
          base_url: baseUrl.trim(),
          api_key: apiKey.trim() ? apiKey.trim() : clearKey || !provider ? null : undefined,
          extra_headers: headers.filter((header) => header.k.trim()),
          timeout_ms: timeout,
        },
        provider?.id,
      )
      notify(provider ? 'Провайдер обновлён' : 'Провайдер добавлен', 'success')
      onClose()
    } catch (err) {
      handleError(err)
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!provider) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testProvider(provider.id)
      setTestResult({
        ok: result.ok,
        message: result.ok ? `Соединение установлено · ${result.latencyMs} мс` : (result.error ?? 'Ошибка соединения'),
      })
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={provider ? 'Провайдер' : 'Новый провайдер'}
      subtitle="OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Ollama, LM Studio или прокси"
      width={600}
      footer={
        <>
          {provider && (
            <button className="btn mr-auto" onClick={() => void test()} disabled={testing}>
              {testing ? <Spinner size={12} /> : null}
              Test connection
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner size={12} className="text-current" /> : null}
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">{error}</div>}
        {testResult && (
          <div
            className={cn(
              'rounded border px-3 py-2 text-[12px]',
              testResult.ok ? 'border-ok/40 bg-ok/5 text-ok' : 'border-danger/40 bg-danger/5 text-danger',
            )}
          >
            {testResult.message}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Название</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="DeepSeek" />
          </div>
          <div>
            <label className="label">Протокол</label>
            <select
              className="input"
              value={protocol}
              onChange={(event) => {
                const next = event.target.value as ProviderProtocol
                setProtocol(next)
                if (!baseUrl || Object.values(PROTOCOL_HINTS).includes(baseUrl)) setBaseUrl(PROTOCOL_HINTS[next])
              }}
            >
              {Object.entries(PROTOCOL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Base URL</label>
          <input
            className="input font-mono text-[12px]"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={PROTOCOL_HINTS[protocol]}
            spellCheck={false}
          />
          <div className="mt-1 text-[10px] text-faint">
            Без завершающего слэша. Для OpenAI укажите .../v1, для совместимых API часто достаточно корня.
          </div>
        </div>

        <div>
          <label className="label">API Key {provider?.has_key && <span className="text-faint">(сохранён: {provider.key_masked})</span>}</label>
          <div className="relative">
            <input
              className="input pr-9 font-mono text-[12px]"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                if (event.target.value.trim()) setClearKey(false)
              }}
              placeholder={clearKey ? 'ключ будет удалён при сохранении' : provider?.has_key ? 'оставьте пустым, чтобы не менять' : 'sk-…'}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-primary"
              onClick={() => setShowKey((value) => !value)}
              type="button"
            >
              {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] text-faint">
            <span>Ключ хранится локально в зашифрованном виде (AES-256-GCM) и никогда не возвращается в браузер.</span>
            {provider?.has_key && !apiKey.trim() && (
              <button
                type="button"
                className="ml-2 shrink-0 text-danger hover:underline disabled:opacity-50"
                onClick={() => setClearKey(true)}
                disabled={clearKey}
              >
                {clearKey ? 'ключ будет удалён' : 'Удалить ключ'}
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Доп. заголовки</label>
            <button className="btn btn-ghost h-6 px-1.5 text-[11px]" onClick={() => setHeaders([...headers, { k: '', v: '' }])}>
              <Plus size={11} /> добавить
            </button>
          </div>
          {headers.length === 0 && <div className="text-[11px] text-faint">Необязательно. Например, HTTP-Referer для OpenRouter.</div>}
          <div className="space-y-1.5">
            {headers.map((header, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  className="input flex-1 font-mono text-[11px]"
                  placeholder="Header-Name"
                  value={header.k}
                  onChange={(event) => {
                    const next = [...headers]
                    next[index] = { ...header, k: event.target.value }
                    setHeaders(next)
                  }}
                />
                <input
                  className="input flex-1 font-mono text-[11px]"
                  placeholder="value"
                  value={header.v}
                  onChange={(event) => {
                    const next = [...headers]
                    next[index] = { ...header, v: event.target.value }
                    setHeaders(next)
                  }}
                />
                <button
                  className="icon-btn text-faint hover:text-danger"
                  onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="w-[180px]">
          <label className="label">Таймаут, мс</label>
          <input
            className="input font-mono text-[12px]"
            type="number"
            min={5000}
            step={5000}
            value={timeout}
            onChange={(event) => setTimeoutValue(Number(event.target.value))}
          />
        </div>
        {!provider && (
          <div className="text-[10px] text-faint">Test connection доступен после сохранения провайдера.</div>
        )}
      </div>
    </Modal>
  )
}

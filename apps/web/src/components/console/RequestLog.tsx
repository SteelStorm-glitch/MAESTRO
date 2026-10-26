import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { useSessionStore } from '../../store/session'
import { cn, formatTime, formatTokens } from '../../lib/utils'
import { Empty } from '../common/Empty'

export function RequestLog() {
  const requests = useSessionStore((state) => state.requests)
  const refresh = useSessionStore((state) => state.refreshRequests)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    if (!query.trim()) return requests
    const q = query.toLowerCase()
    return requests.filter((request) =>
      `${request.provider} ${request.model} ${request.endpoint} ${request.status}`.toLowerCase().includes(q),
    )
  }, [requests, query])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <div className="relative">
          <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            data-testid="requests-search-input"
            className="h-6 w-[190px] rounded border border-border bg-base pl-6 pr-2 text-[11px] text-primary outline-none placeholder:text-faint focus:border-[#3a3a46]"
            placeholder="провайдер, модель, статус…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <span className="text-[10px] text-faint">{filtered.length} запросов</span>
        <button className="icon-btn ml-auto h-6 w-6" title="Обновить" onClick={() => void refresh()}>
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <Empty compact icon={RefreshCw} title="Запросов ещё не было" description="Здесь видны HTTP-вызовы к провайдерам с latency и токенами." />
        )}
        <div className="min-w-[720px]">
          <div className="sticky top-0 z-10 grid grid-cols-[74px_110px_150px_1fr_90px_80px_90px_18px] gap-2 border-b border-border bg-panel px-3 py-1 text-[10px] uppercase tracking-wide text-faint">
            <span>время</span>
            <span>провайдер</span>
            <span>модель</span>
            <span>endpoint</span>
            <span>статус</span>
            <span>latency</span>
            <span>токены</span>
            <span />
          </div>
          {filtered.map((request, index) => {
            const open = openIndex === index
            const failed = request.status === 'error' || (typeof request.status === 'number' && request.status >= 400)
            return (
              <div key={`${request.endpoint}-${index}`} className="border-b border-border/60">
                <button
                  className="grid w-full grid-cols-[74px_110px_150px_1fr_90px_80px_90px_18px] items-center gap-2 px-3 py-[5px] text-left font-mono text-[11px] hover:bg-elevated"
                  onClick={() => setOpenIndex(open ? null : index)}
                >
                  <span className="text-faint">{request.at ? formatTime(request.at) : '—'}</span>
                  <span className="truncate text-dim">{request.provider ?? '—'}</span>
                  <span className="truncate text-dim" title={request.model}>
                    {request.model}
                  </span>
                  <span className="truncate text-faint" title={request.endpoint}>
                    {request.endpoint.replace(/^https?:\/\//, '')}
                  </span>
                  <span className={cn('truncate', failed ? 'text-danger' : 'text-ok')}>
                    {String(request.status)}
                    {request.error ? ` · ${request.error.slice(0, 60)}` : ''}
                  </span>
                  <span className="text-faint">{request.latency_ms} мс</span>
                  <span className="text-faint">
                    ↑{formatTokens(request.tokens_in ?? 0)} ↓{formatTokens(request.tokens_out ?? 0)}
                  </span>
                  {open ? <ChevronDown size={11} className="text-faint" /> : <ChevronRight size={11} className="text-faint" />}
                </button>
                {open && (
                  <div className="grid grid-cols-2 gap-2 bg-base px-3 py-2">
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">Запрос</div>
                      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-panel p-2 text-[10px] leading-4 text-dim">
                        {request.request ?? '(тело не сохранено)'}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">Ответ</div>
                      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-panel p-2 text-[10px] leading-4 text-dim">
                        {request.response_preview ?? request.error ?? '(нет)'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

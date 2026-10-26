import { Copy, FileWarning, X } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useFilesStore } from '../../store/files'
import { formatBytes } from '../../lib/utils'
import { Spinner } from '../common/Spinner'
import { CodeEditor } from './CodeEditor'

export function FilePreview() {
  const { preview, previewOpen, previewLoading, closePreview } = useFilesStore()
  const notify = useAppStore((state) => state.notify)
  if (!previewOpen) return null

  const copy = async () => {
    if (!preview) return
    try {
      await navigator.clipboard.writeText(preview.path)
      notify('Путь скопирован', 'success')
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed bottom-[calc(30%+16px)] right-[300px] z-40 flex h-[58vh] w-[min(620px,55vw)] flex-col overflow-hidden rounded-md border border-border bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] text-primary" title={preview?.path}>
            {preview?.path ?? 'загрузка…'}
          </div>
        </div>
        {preview && (
          <span className="text-[10px] text-faint">
            {formatBytes(preview.size)}
            {preview.truncated ? ' · обрезано' : ''}
          </span>
        )}
        <button className="icon-btn" title="Копировать путь" onClick={() => void copy()}>
          <Copy size={13} />
        </button>
        <button className="icon-btn" title="Закрыть" onClick={closePreview}>
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {previewLoading && (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-faint">
            <Spinner size={13} /> читаю файл…
          </div>
        )}
        {!previewLoading && preview?.binary && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <FileWarning size={22} className="text-warn" />
            <div className="text-[12px] text-dim">Бинарный файл — предпросмотр недоступен</div>
            <div className="text-[11px] text-faint">{preview.path}</div>
          </div>
        )}
        {!previewLoading && preview && !preview.binary && (
          <CodeEditor value={preview.content} path={preview.path} readOnly />
        )}
      </div>
    </div>
  )
}

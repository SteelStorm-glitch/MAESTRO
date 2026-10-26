import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '../../store/app'

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts)
  const dismiss = useAppStore((state) => state.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'error' ? AlertTriangle : toast.kind === 'success' ? CheckCircle2 : Info
        const color = toast.kind === 'error' ? 'var(--danger)' : toast.kind === 'success' ? 'var(--ok)' : 'var(--accent)'
        return (
          <div
            key={toast.id}
            className="fade-in pointer-events-auto flex items-start gap-2.5 rounded-md border border-border bg-elevated px-3 py-2.5"
          >
            <Icon size={14} style={{ color }} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-dim">
              {toast.message}
            </div>
            <button className="text-faint hover:text-primary" onClick={() => dismiss(toast.id)}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

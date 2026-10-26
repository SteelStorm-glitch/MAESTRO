import { ShieldAlert } from 'lucide-react'
import type { ApprovalRequest } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { useSessionStore } from '../../store/session'
import { RoleBadge } from '../common/Badge'

export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const roles = useAppStore((state) => state.roles)
  const approve = useSessionStore((state) => state.approve)
  const role = roles.find((item) => item.id === request.role_id) ?? null
  const command = typeof request.args.command === 'string' ? request.args.command : JSON.stringify(request.args)

  return (
    <div className="fade-in rounded-md border border-warn/50 bg-[#1b160b] px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert size={14} className="text-warn" />
        <span className="text-[12px] font-medium text-warn">Требуется подтверждение</span>
        <span className="ml-auto">
          <RoleBadge role={role} size="sm" />
        </span>
      </div>
      <p className="mb-2 text-[12px] text-dim">
        Агент <span className="text-primary">{role?.name ?? request.role_name}</span> хочет выполнить:
      </p>
      <pre className="mono mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded border border-border bg-base px-2.5 py-2 text-[12px] text-primary">
        {command}
      </pre>
      <div className="flex items-center justify-end gap-2">
        <button className="btn" onClick={() => void approve(request.id, false)}>
          Отклонить
        </button>
        <button className="btn btn-primary" onClick={() => void approve(request.id, true)}>
          Разрешить
        </button>
      </div>
    </div>
  )
}

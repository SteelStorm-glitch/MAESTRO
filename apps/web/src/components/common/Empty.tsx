import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function Empty({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'gap-2 p-5' : 'gap-3 p-10'}`}>
      <div className={`rounded-full bg-elevated flex items-center justify-center ${compact ? 'h-8 w-8' : 'h-11 w-11'}`}>
        <Icon size={compact ? 15 : 19} className="text-faint" />
      </div>
      <div>
        <div className={`${compact ? 'text-[12px]' : 'text-[14px]'} font-medium text-dim`}>{title}</div>
        {description && <div className="mt-1 max-w-[260px] text-[12px] leading-5 text-faint">{description}</div>}
      </div>
      {action}
    </div>
  )
}

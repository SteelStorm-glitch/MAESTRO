import type { Role } from '@maestro/shared'

export function RoleBadge({
  role,
  size = 'md',
  showName = true,
}: {
  role: Pick<Role, 'name' | 'color'> | null | undefined
  size?: 'sm' | 'md'
  showName?: boolean
}) {
  if (!role) {
    return (
      <span className="inline-flex items-center gap-1.5 text-faint">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--text-faint)' }} />
        {showName && <span className="text-[12px]">Пользователь</span>}
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className="inline-block shrink-0 rounded-full"
        style={{
          background: role.color,
          width: size === 'sm' ? 6 : 8,
          height: size === 'sm' ? 6 : 8,
          boxShadow: `0 0 0 2px ${role.color}22`,
        }}
      />
      {showName && (
        <span className={`truncate ${size === 'sm' ? 'text-[11px]' : 'text-[12px]'} text-primary`}>{role.name}</span>
      )}
    </span>
  )
}

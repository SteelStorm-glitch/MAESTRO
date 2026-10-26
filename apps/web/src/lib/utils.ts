import type { MessageKind } from '@maestro/shared'

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function formatTokens(value: number): string {
  if (!value) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(2)}M`
}

export function formatCost(value: number): string {
  if (!value) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч назад`
  return formatDateTime(timestamp)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const KIND_LABELS: Record<MessageKind, string> = {
  user: 'Задача',
  plan: 'План',
  task: 'Результат',
  result: 'Результат',
  tool_call: 'Инструмент',
  tool_result: 'Вывод',
  final: 'Финал',
  error: 'Ошибка',
  system: 'Система',
}

export const KIND_COLORS: Record<MessageKind, string> = {
  user: 'var(--text-primary)',
  plan: 'var(--accent)',
  task: 'var(--text-dim)',
  result: 'var(--ok)',
  tool_call: 'var(--warn)',
  tool_result: 'var(--text-faint)',
  final: 'var(--accent)',
  error: 'var(--danger)',
  system: 'var(--text-faint)',
}

export function statusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'var(--accent)'
    case 'done':
      return 'var(--ok)'
    case 'error':
      return 'var(--danger)'
    case 'paused':
      return 'var(--warn)'
    case 'cancelled':
      return 'var(--text-faint)'
    default:
      return 'var(--text-faint)'
  }
}

export const STATUS_LABELS: Record<string, string> = {
  idle: 'ожидание',
  running: 'выполняется',
  paused: 'пауза',
  done: 'готово',
  error: 'ошибка',
  cancelled: 'отменено',
  pending: 'ожидает',
  failed: 'провал',
  skipped: 'пропущена',
}

export function shortPath(path: string, max = 48): string {
  if (path.length <= max) return path
  const parts = path.split('/')
  return `…/${parts.slice(-2).join('/')}`
}

export function parseJsonSafe<T = unknown>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function fileIconType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return 'code'
  if (['json', 'yaml', 'yml', 'toml', 'ini'].includes(ext)) return 'config'
  if (['md', 'txt', 'rst'].includes(ext)) return 'text'
  if (['py', 'rs', 'go', 'java', 'rb', 'php', 'cs', 'cpp', 'c', 'h'].includes(ext)) return 'code'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'image'
  if (['css', 'scss', 'less', 'html'].includes(ext)) return 'web'
  return 'file'
}

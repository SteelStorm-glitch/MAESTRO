import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Terminal, Wrench } from 'lucide-react'
import type { Message } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn, formatTokens, KIND_COLORS, KIND_LABELS } from '../../lib/utils'
import { RoleBadge } from '../common/Badge'

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key++} className="mono rounded bg-elevated px-1 py-0.5 text-[11px] text-[#c9c9ff]">
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      nodes.push(
        <strong key={key++} className="font-semibold text-primary">
          {token.slice(2, -2)}
        </strong>,
      )
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function RichText({ content }: { content: string }) {
  const parts = useMemo(() => content.split(/(```[\s\S]*?```)/g), [content])
  return (
    <div className="space-y-2 text-[13px] leading-[21px] text-dim">
      {parts.map((part, index) => {
        if (part.startsWith('```')) {
          const body = part.slice(3).replace(/^[a-zA-Z0-9+-]*\n/, '').replace(/```$/, '')
          return (
            <pre
              key={index}
              className="mono overflow-x-auto rounded border border-border bg-base px-3 py-2 text-[12px] leading-5 text-[#d6d6e0]"
            >
              {body.replace(/\n$/, '')}
            </pre>
          )
        }
        const lines = part.split('\n')
        return (
          <div key={index} className="whitespace-pre-wrap break-words">
            {lines.map((line, lineIndex) => (
              <div key={lineIndex}>
                {renderInline(line)}
                {lineIndex < lines.length - 1 ? '\n' : null}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function parsePayload(content: string): Record<string, unknown> | null {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function StructuredContent({ kind, content }: { kind: Message['kind']; content: string }) {
  const parsed = useMemo(() => parsePayload(content), [content])

  if (kind === 'plan' && parsed) {
    if (parsed.type === 'final' && typeof parsed.text === 'string') {
      return <RichText content={String(parsed.text)} />
    }
    if (Array.isArray(parsed.tasks)) {
      const tasks = parsed.tasks as Array<Record<string, unknown>>
      return (
        <div className="space-y-1">
          <div className="text-[12px] text-dim">
            План: <span className="text-primary">{tasks.length}</span> задач
          </div>
          {tasks.slice(0, 12).map((task, index) => (
            <div key={index} className="flex items-start gap-2 text-[12px] text-dim">
              <span className="w-4 shrink-0 font-mono text-[10px] text-faint">{index + 1}</span>
              <span className="min-w-0 flex-1">{String(task.title ?? '')}</span>
              {task.assignee ? <span className="shrink-0 text-[10px] text-faint">{String(task.assignee)}</span> : null}
            </div>
          ))}
          {tasks.length > 12 && <div className="text-[11px] text-faint">… ещё {tasks.length - 12}</div>}
        </div>
      )
    }
  }

  if (kind === 'result' && parsed && typeof parsed.verdict === 'string') {
    const pass = String(parsed.verdict) === 'pass'
    const issues = Array.isArray(parsed.issues) ? parsed.issues : []
    return (
      <div className="space-y-1 text-[12px]">
        <div className={pass ? 'text-ok' : 'text-warn'}>
          Вердикт: {pass ? 'pass — замечаний нет' : `issues — ${issues.length}`}
        </div>
        {typeof parsed.summary === 'string' && parsed.summary && (
          <div className="text-dim">{parsed.summary}</div>
        )}
        {issues.slice(0, 8).map((issue, index) => {
          const item = (issue ?? {}) as Record<string, unknown>
          return (
            <div key={index} className="text-[11px] text-warn">
              • {String(item.title ?? '')}
              {item.file ? <span className="ml-1 font-mono text-faint">{String(item.file)}</span> : null}
            </div>
          )
        })}
      </div>
    )
  }

  return <RichText content={content} />
}

export function MessageCard({ message }: { message: Message }) {
  const roles = useAppStore((state) => state.roles)
  const role = roles.find((item) => item.id === message.role_id) ?? null
  const target = roles.find((item) => item.id === message.to_role_id) ?? null
  const isTool = message.kind === 'tool_call' || message.kind === 'tool_result'
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const label = KIND_LABELS[message.kind] ?? message.kind
  const color = KIND_COLORS[message.kind] ?? 'var(--text-dim)'
  const long = message.content.length > 1800
  const shown = long && !expanded ? `${message.content.slice(0, 1800)}\n… (ещё ${message.content.length - 1800} символов)` : message.content

  if (isTool) {
    let summary = message.content
    if (message.kind === 'tool_call') {
      try {
        const parsed = JSON.parse(message.content) as { tool?: string; args?: unknown }
        summary = `${parsed.tool ?? 'tool'} ${JSON.stringify(parsed.args ?? {}).slice(0, 160)}`
      } catch {
        /* keep raw */
      }
    } else {
      summary = message.content.slice(0, 160).replace(/\n/g, ' ')
    }
    return (
      <div className="fade-in ml-1 border-l border-border pl-3">
        <button
          className="flex w-full items-center gap-1.5 py-1 text-left text-[11px] text-faint hover:text-dim"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {message.kind === 'tool_call' ? <Wrench size={11} /> : <Terminal size={11} />}
          <span className="truncate font-mono">{summary || '(пусто)'}</span>
          <span className="ml-auto shrink-0 pl-2">{formatTokens(message.tokens_out)}</span>
        </button>
        {open && (
          <pre className="mono mb-2 max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-base px-2.5 py-2 text-[11px] leading-4 text-faint">
            {message.kind === 'tool_call' ? prettyJson(message.content) : message.content}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'fade-in rounded-md border bg-panel px-3.5 py-3',
        message.kind === 'final'
          ? 'border-accent/40 bg-[#141420]'
          : message.kind === 'error'
            ? 'border-danger/40'
            : 'border-border',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <RoleBadge role={role} />
        {target && (
          <span className="text-[11px] text-faint">
            → <span className="text-dim">{target.name}</span>
          </span>
        )}
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{ color, background: `${color}14` }}
        >
          {label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-faint">
          {(message.tokens_in > 0 || message.tokens_out > 0) && (
            <span className="mono">
              ↑{formatTokens(message.tokens_in)} ↓{formatTokens(message.tokens_out)}
            </span>
          )}
          <span>{new Date(message.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      </div>
      {message.kind === 'plan' || message.kind === 'result' ? (
        <StructuredContent kind={message.kind} content={message.content} />
      ) : (
        <RichText content={shown} />
      )}
      {long && message.kind !== 'plan' && message.kind !== 'result' && (
        <button className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'свернуть' : 'показать полностью'}
        </button>
      )}
    </div>
  )
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

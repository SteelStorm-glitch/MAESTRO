import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, Plus, X } from 'lucide-react'
import { useAppStore } from '../../store/app'
import { useSessionStore } from '../../store/session'
import { cn } from '../../lib/utils'
import { Spinner } from '../common/Spinner'

export function InputBox() {
  const { projectId, orchestraId, orchestras, roles, startSession, notify, newSession } = useAppStore()
  const { sessionId, status, send, loading } = useSessionStore()
  const [text, setText] = useState('')
  const [toRoleId, setToRoleId] = useState<string | null>(null)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const orchestra = orchestras.find((item) => item.id === orchestraId) ?? null
  const memberRoles = useMemo(() => {
    if (!orchestra) return []
    const ids = new Set(orchestra.members.map((member) => member.role_id))
    return roles.filter((role) => ids.has(role.id))
  }, [orchestra, roles])

  const suggestions = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    return memberRoles.filter((role) => role.name.toLowerCase().includes(query)).slice(0, 6)
  }, [mention, memberRoles])

  const selectedRole = roles.find((role) => role.id === toRoleId) ?? null
  const running = status === 'running' || status === 'paused'

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  const handleChange = (value: string, cursor: number) => {
    setText(value)
    const before = value.slice(0, cursor)
    const match = /(^|\s)@([\wА-Яа-яЁё -]*)$/.exec(before)
    if (match) {
      setMention({ query: match[2] ?? '', start: cursor - (match[2]?.length ?? 0) - 1 })
      setMentionIndex(0)
    } else {
      setMention(null)
    }
  }

  const applyMention = (roleId: string) => {
    if (!mention) return
    const role = roles.find((item) => item.id === roleId)
    if (!role) return
    const before = text.slice(0, mention.start)
    const after = text.slice(mention.start + mention.query.length + 1)
    setText(`${before}@${role.name} ${after}`)
    setToRoleId(role.id)
    setMention(null)
    textareaRef.current?.focus()
  }

  const submit = async () => {
    const value = text.trim()
    if (!value || sending) return
    if (!projectId) {
      notify('Сначала выберите папку проекта', 'error')
      return
    }
    if (!orchestraId) {
      notify('Сначала создайте оркестр', 'error')
      return
    }
    setSending(true)
    try {
      if (!sessionId) {
        await startSession(value)
      } else {
        await send(value, toRoleId)
      }
      setText('')
      setToRoleId(null)
    } catch (error) {
      useAppStore.getState().handleError(error)
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((index) => (index + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((index) => (index - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applyMention(suggestions[mentionIndex]!.id)
        return
      }
      if (event.key === 'Escape') {
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className="relative border-t border-border bg-panel px-3 py-2.5">
      {mention && suggestions.length > 0 && (
        <div className="absolute bottom-full left-3 z-30 mb-1 w-[260px] overflow-hidden rounded-md border border-border bg-elevated py-1">
          {suggestions.map((role, index) => (
            <button
              key={role.id}
              className={cn(
                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]',
                index === mentionIndex ? 'bg-active text-primary' : 'text-dim hover:bg-active',
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                applyMention(role.id)
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: role.color }} />
              {role.name}
              <span className="ml-auto text-[10px] text-faint">{role.permission}</span>
            </button>
          ))}
        </div>
      )}

      {selectedRole && (
        <div className="mb-1.5 inline-flex items-center gap-1.5 rounded bg-elevated px-2 py-0.5 text-[11px] text-dim">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: selectedRole.color }} />
          сообщение для {selectedRole.name}
          <button onClick={() => setToRoleId(null)} className="text-faint hover:text-primary">
            <X size={11} />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-md border border-border bg-base px-2 py-1.5 focus-within:border-[#3a3a46]">
        <button
          className="icon-btn mb-0.5 shrink-0"
          title="Новый запуск (очистить текущую сессию)"
          onClick={() => {
            newSession()
            setText('')
            textareaRef.current?.focus()
          }}
        >
          <Plus size={15} />
        </button>
        <textarea
          ref={textareaRef}
          data-testid="task-input"
          rows={1}
          value={text}
          placeholder={
            sessionId
              ? running
                ? 'Сообщение в очередь или @упоминание агента…'
                : 'Продолжить диалог или поставить новую задачу…'
              : 'Опишите задачу для оркестра…'
          }
          className="max-h-[180px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-5 text-primary outline-none placeholder:text-faint"
          onChange={(event) => handleChange(event.target.value, event.target.selectionStart)}
          onKeyDown={onKeyDown}
          onClick={(event) => handleChange(text, event.currentTarget.selectionStart)}
        />
        <button
          data-testid="btn-task-submit"
          className={cn('mb-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-[12px]', text.trim() ? 'btn-primary' : 'btn')}
          disabled={!text.trim() || sending || loading}
          onClick={() => void submit()}
          title="Отправить (Enter)"
        >
          {sending || loading ? <Spinner size={12} className="text-current" /> : <ArrowUp size={13} />}
          {running ? 'В очередь' : 'Запустить'}
        </button>
      </div>
      <div className="mt-1 flex items-center gap-3 px-1 text-[10px] text-faint">
        <span>Enter — отправить · Shift+Enter — новая строка</span>
        <span>@ — адресовать агенту</span>
        {!sessionId && <span className="text-accent">новый запуск</span>}
        {sessionId && !running && <span>запуск завершён — можно продолжить</span>}
      </div>
    </div>
  )
}

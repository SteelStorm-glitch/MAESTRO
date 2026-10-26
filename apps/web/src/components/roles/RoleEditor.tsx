import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { Role, RolePermission, ShellMode } from '@maestro/shared'
import { DEFAULT_COLORS } from '@maestro/shared'
import { useAppStore } from '../../store/app'
import { cn, formatTokens } from '../../lib/utils'
import { Modal } from '../common/Modal'
import { Spinner } from '../common/Spinner'

const TOOL_META: Array<{ name: string; label: string; permission: 'read' | 'write' | 'shell' }> = [
  { name: 'fs_list', label: 'Список файлов', permission: 'read' },
  { name: 'fs_read', label: 'Чтение файла', permission: 'read' },
  { name: 'fs_search', label: 'Поиск по коду', permission: 'read' },
  { name: 'fs_write', label: 'Запись файла', permission: 'write' },
  { name: 'fs_append', label: 'Дописать в файл', permission: 'write' },
  { name: 'fs_move', label: 'Перемещение', permission: 'write' },
  { name: 'fs_delete', label: 'Удаление (в корзину)', permission: 'write' },
  { name: 'shell_exec', label: 'Терминал', permission: 'shell' },
  { name: 'git_status', label: 'git status', permission: 'read' },
  { name: 'git_diff', label: 'git diff', permission: 'read' },
  { name: 'git_log', label: 'git log', permission: 'read' },
]

const DEFAULT_WRITE_TOOLS = TOOL_META.filter((tool) => tool.permission !== 'shell').map((tool) => tool.name)

const PERMISSIONS: Array<{ value: RolePermission; label: string; hint: string }> = [
  { value: 'read', label: 'read', hint: 'только чтение' },
  { value: 'write', label: 'write', hint: 'чтение и запись' },
  { value: 'admin', label: 'admin', hint: 'всё разрешено' },
]

const SHELL_MODES: Array<{ value: ShellMode; label: string; hint: string }> = [
  { value: 'off', label: 'off', hint: 'запрещён' },
  { value: 'confirm', label: 'confirm', hint: 'спрашивать' },
  { value: 'auto', label: 'auto', hint: 'без спроса' },
]

export function RoleEditor({
  open,
  role,
  onClose,
  onSaved,
}: {
  open: boolean
  role: Role | null
  onClose: () => void
  onSaved?: (role: Role) => void
}) {
  const { models, providers, saveRole, deleteRole, notify, handleError } = useAppStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [modelId, setModelId] = useState<string | null>(null)
  const [temperature, setTemperature] = useState(0.7)
  const [tools, setTools] = useState<string[]>([])
  const [permission, setPermission] = useState<RolePermission>('write')
  const [shellMode, setShellMode] = useState<ShellMode>('off')
  const [color, setColor] = useState<string>(DEFAULT_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(role?.name ?? 'Новая роль')
    setDescription(role?.description ?? '')
    setSystemPrompt(role?.system_prompt ?? '')
    setModelId(role?.model_id ?? null)
    setTemperature(role?.temperature ?? 0.7)
    setTools(role ? role.tools : DEFAULT_WRITE_TOOLS)
    setPermission(role?.permission ?? 'write')
    setShellMode(role?.shell_mode ?? 'off')
    setColor(role?.color ?? DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]!)
    setError(null)
  }, [open, role])

  const selectedModel = models.find((model) => model.id === modelId) ?? null
  const groupedModels = useMemo(() => {
    const groups = new Map<string, typeof models>()
    for (const provider of providers) {
      const list = models.filter((model) => model.provider_id === provider.id)
      if (list.length > 0) groups.set(provider.name, list)
    }
    return [...groups.entries()]
  }, [models, providers])

  const toggleTool = (toolName: string) => {
    setTools((current) =>
      current.includes(toolName) ? current.filter((name) => name !== toolName) : [...current, toolName],
    )
  }

  const save = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Укажите имя роли')
      return
    }
    setSaving(true)
    try {
      const saved = await saveRole(
        {
          name: name.trim(),
          description,
          system_prompt: systemPrompt,
          model_id: modelId,
          temperature,
          tools,
          permission,
          shell_mode: shellMode,
          color,
        },
        role?.id,
      )
      notify(role ? 'Роль обновлена' : 'Роль создана', 'success')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      handleError(err)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!role) return
    if (!window.confirm(`Удалить роль «${role.name}»? Она будет убрана из всех оркестров.`)) return
    try {
      await deleteRole(role.id)
      notify('Роль удалена', 'success')
      onClose()
    } catch (err) {
      handleError(err)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      wide
      title={role ? `Роль · ${role.name}` : 'Новая роль'}
      subtitle="Системный промпт, модель и разрешения агента"
      footer={
        <>
          {role && (
            <button className="btn btn-danger mr-auto" onClick={() => void remove()}>
              <Trash2 size={12} /> Удалить
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving && <Spinner size={12} className="text-current" />}
            Сохранить
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">{error}</div>}

        <div className="grid grid-cols-[1fr_1fr_150px] gap-3">
          <div>
            <label className="label">Имя</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className="label">Описание</label>
            <input
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Что делает эта роль"
            />
          </div>
          <div>
            <label className="label">Цвет бейджа</label>
            <div className="flex flex-wrap items-center gap-1">
              {DEFAULT_COLORS.map((preset) => (
                <button
                  key={preset}
                  className={cn('h-4 w-4 rounded-full border', color === preset ? 'border-white' : 'border-transparent')}
                  style={{ background: preset }}
                  onClick={() => setColor(preset)}
                />
              ))}
              <input
                type="color"
                className="h-5 w-5 cursor-pointer rounded border border-border bg-transparent p-0"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <label className="label">Модель</label>
          <select
            className="input"
            value={modelId ?? ''}
            onChange={(event) => setModelId(event.target.value || null)}
          >
            <option value="">— не выбрана —</option>
            {groupedModels.map(([providerName, list]) => (
              <optgroup key={providerName} label={providerName}>
                {list.map((model) => (
                  <option key={model.id} value={model.id} disabled={!model.enabled}>
                    {model.display_name}
                    {!model.enabled ? ' (отключена)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-faint">
            {selectedModel ? (
              <>
                <span className="mono">{selectedModel.model_id}</span>
                <span>контекст: {formatTokens(selectedModel.context_window)}</span>
                <span>max out: {formatTokens(selectedModel.max_output)}</span>
                <span className={selectedModel.supports_tools ? 'text-ok' : 'text-warn'}>
                  {selectedModel.supports_tools ? 'tools: да' : 'tools: нет (JSON-фолбэк)'}
                </span>
              </>
            ) : (
              <span>Без модели роль не сможет участвовать в запуске.</span>
            )}
          </div>
        </div>

        <div>
          <label className="label">System prompt</label>
          <textarea
            className="input mono min-h-[170px] resize-y text-[12px] leading-5"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="Ты — … Работаешь в проекте {{project_root}} как {{role_name}}. Команда: {{team_roster}}"
            spellCheck={false}
          />
          <div className="mt-1 text-[10px] text-faint">
            Плейсхолдеры <span className="mono">{'{{project_root}}'}</span>,{' '}
            <span className="mono">{'{{role_name}}'}</span>, <span className="mono">{'{{team_roster}}'}</span>{' '}
            подставляются движком.
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Права</label>
            <div className="flex gap-1">
              {PERMISSIONS.map((item) => (
                <button
                  key={item.value}
                  className={cn(
                    'flex-1 rounded border px-2 py-1.5 text-left text-[11px]',
                    permission === item.value
                      ? 'border-accent/60 bg-accent/10 text-primary'
                      : 'border-border text-dim hover:bg-elevated',
                  )}
                  onClick={() => {
                    setPermission(item.value)
                    if (item.value === 'read') setShellMode('off')
                  }}
                >
                  <div className="font-medium">{item.label}</div>
                  <div className="text-[10px] text-faint">{item.hint}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Shell</label>
            <div className="flex gap-1">
              {SHELL_MODES.map((item) => (
                <button
                  key={item.value}
                  disabled={permission === 'read'}
                  className={cn(
                    'flex-1 rounded border px-2 py-1.5 text-left text-[11px] disabled:opacity-40',
                    shellMode === item.value
                      ? 'border-accent/60 bg-accent/10 text-primary'
                      : 'border-border text-dim hover:bg-elevated',
                  )}
                  onClick={() => setShellMode(item.value)}
                >
                  <div className="font-medium">{item.label}</div>
                  <div className="text-[10px] text-faint">{item.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label">Инструменты</label>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-border p-2.5">
            {TOOL_META.map((tool) => {
              const disabled =
                (tool.permission === 'write' && permission === 'read') ||
                (tool.permission === 'shell' && (permission === 'read' || shellMode === 'off'))
              const checked = tools.includes(tool.name)
              return (
                <label
                  key={tool.name}
                  className={cn('flex cursor-pointer items-center gap-2 text-[12px]', disabled && 'opacity-40')}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleTool(tool.name)}
                  />
                  <span className={checked ? 'text-primary' : 'text-dim'}>{tool.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-faint">{tool.name}</span>
                </label>
              )
            })}
          </div>
          <div className="mt-1 text-[10px] text-faint">
            Пустой список означает «все инструменты, разрешённые правами», кроме shell_exec — он всегда требует явного
            выбора.
          </div>
        </div>

        <div className="w-[260px]">
          <label className="label">
            Температура: <span className="mono text-dim">{temperature.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={temperature}
            className="w-full accent-[#8B8BF5]"
            onChange={(event) => setTemperature(Number(event.target.value))}
          />
        </div>
      </div>
    </Modal>
  )
}

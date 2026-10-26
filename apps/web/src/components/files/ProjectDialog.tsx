import { useEffect, useState } from 'react'
import { ArrowUp, Folder, HardDrive, Home, Trash2 } from 'lucide-react'
import { api, type BrowseResult } from '../../api/client'
import { useAppStore } from '../../store/app'
import { cn, shortPath } from '../../lib/utils'
import { Modal } from '../common/Modal'
import { Spinner } from '../common/Spinner'

export function ProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { projects, projectId, createProject, deleteProject, selectProject, handleError, notify } = useAppStore()
  const [browse, setBrowse] = useState<BrowseResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [name, setName] = useState('')
  const [connecting, setConnecting] = useState(false)

  const load = async (path?: string) => {
    setLoading(true)
    try {
      const result = await api.fs.browse(path)
      setBrowse(result)
      setPathInput(result.path)
    } catch (error) {
      handleError(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setName('')
    void load(undefined)
  }, [open])

  const connect = async (rootPath: string) => {
    setConnecting(true)
    try {
      await createProject(rootPath, name.trim() || undefined)
      onClose()
    } catch (error) {
      handleError(error)
    } finally {
      setConnecting(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Отключить проект? Файлы на диске останутся на месте.')) return
    try {
      await deleteProject(id)
      notify('Проект отключён', 'success')
    } catch (error) {
      handleError(error)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Папка проекта"
      subtitle="Агенты будут читать и менять файлы только внутри этой папки"
      width={720}
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <input
              className="input h-7 w-[180px] text-[12px]"
              placeholder="Имя проекта (опционально)"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={!browse || connecting}
            onClick={() => browse && void connect(browse.path)}
          >
            {connecting ? <Spinner size={12} className="text-current" /> : null}
            Подключить эту папку
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Существующие проекты</label>
          {projects.length === 0 && <div className="text-[11px] text-faint">Пока нет подключённых проектов.</div>}
          <div className="space-y-1">
            {projects.map((project) => (
              <div
                key={project.id}
                className={cn(
                  'flex items-center gap-2 rounded border px-2.5 py-1.5',
                  project.id === projectId ? 'border-accent/50 bg-active' : 'border-border bg-panel',
                )}
              >
                <Folder size={13} className="text-accent" />
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    selectProject(project.id)
                    onClose()
                  }}
                >
                  <div className="truncate text-[12px] text-primary">{project.name}</div>
                  <div className="truncate text-[10px] text-faint" title={project.root_path}>
                    {shortPath(project.root_path, 60)}
                  </div>
                </button>
                <button className="icon-btn h-6 w-6 hover:text-danger" onClick={() => void remove(project.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div>
          <label className="label">Выбрать папку на диске</label>
          <div className="mb-2 flex items-center gap-1.5">
            <button className="icon-btn" title="Домашняя папка" onClick={() => void load(undefined)}>
              <Home size={13} />
            </button>
            <button
              className="icon-btn"
              title="На уровень выше"
              disabled={!browse?.parent}
              onClick={() => browse?.parent && void load(browse.parent)}
            >
              <ArrowUp size={13} />
            </button>
            <input
              className="input h-7 flex-1 font-mono text-[11px]"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void load(pathInput)
              }}
              spellCheck={false}
            />
            <button className="btn h-7 text-[11px]" onClick={() => void load(pathInput)}>
              Перейти
            </button>
          </div>

          {browse && browse.drives.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {browse.drives.map((drive) => (
                <button key={drive} className="chip hover:text-primary" onClick={() => void load(drive)}>
                  <HardDrive size={10} /> {drive}
                </button>
              ))}
            </div>
          )}

          <div className="h-[260px] overflow-y-auto rounded border border-border bg-base">
            {loading && (
              <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-faint">
                <Spinner size={11} /> читаю каталог…
              </div>
            )}
            {!loading && browse?.dirs.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-faint">Нет вложенных папок.</div>
            )}
            {browse?.dirs.map((dir) => (
              <button
                key={dir.path}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-dim hover:bg-elevated hover:text-primary"
                onClick={() => void load(dir.path)}
              >
                <Folder size={12} className="text-faint" />
                <span className="truncate">{dir.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-1 text-[10px] text-faint">
            Текущая папка: <span className="mono">{browse?.path ?? '—'}</span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

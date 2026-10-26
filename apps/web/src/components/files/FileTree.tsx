import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  EyeOff,
  File,
  FileCode2,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Image as ImageIcon,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import type { TreeNode } from '@maestro/shared'
import { api } from '../../api/client'
import { useAppStore } from '../../store/app'
import { useFilesStore } from '../../store/files'
import { cn, fileIconType, shortPath } from '../../lib/utils'
import { Empty } from '../common/Empty'
import { Modal } from '../common/Modal'
import { Spinner } from '../common/Spinner'

interface MenuState {
  x: number
  y: number
  node: TreeNode | null
}

interface DialogState {
  mode: 'create-file' | 'create-dir' | 'rename'
  node?: TreeNode | null
  value: string
  parent?: string
}

function NodeIcon({ node, open }: { node: TreeNode; open: boolean }) {
  if (node.type === 'dir') {
    return open ? (
      <FolderOpen size={13} className="shrink-0 text-[#8B8BF5]" />
    ) : (
      <Folder size={13} className="shrink-0 text-[#7d7d92]" />
    )
  }
  switch (fileIconType(node.name)) {
    case 'code':
      return <FileCode2 size={13} className="shrink-0 text-[#5AC8FA]" />
    case 'config':
      return <FileJson size={13} className="shrink-0 text-[#FFB224]" />
    case 'text':
      return <FileText size={13} className="shrink-0 text-[#9C9CA5]" />
    case 'image':
      return <ImageIcon size={13} className="shrink-0 text-[#46A758]" />
    case 'web':
      return <FileCode2 size={13} className="shrink-0 text-[#F76B15]" />
    default:
      return <File size={13} className="shrink-0 text-[#5C5C66]" />
  }
}

function TouchMark({ kind }: { kind: 'created' | 'modified' | 'deleted' }) {
  const color = kind === 'created' ? 'var(--ok)' : kind === 'modified' ? 'var(--warn)' : 'var(--danger)'
  const char = kind === 'created' ? '+' : kind === 'modified' ? '~' : '-'
  return (
    <span className="ml-auto pl-2 font-mono text-[11px]" style={{ color }} title={kind}>
      {char}
    </span>
  )
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes
  const q = query.toLowerCase()
  const out: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'dir' && node.children) {
      const filteredChildren = filterTree(node.children, query)
      if (filteredChildren.length > 0 || node.name.toLowerCase().includes(q)) {
        out.push({ ...node, children: filteredChildren })
      }
    } else if (node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q)) {
      out.push(node)
    }
  }
  return out
}

function collectDirPaths(nodes: TreeNode[], set: Set<string>): void {
  for (const node of nodes) {
    if (node.type === 'dir') {
      set.add(node.path)
      if (node.children) collectDirPaths(node.children, set)
    }
  }
}

export function FileTree() {
  const projectId = useAppStore((state) => state.projectId)
  const projects = useAppStore((state) => state.projects)
  const notify = useAppStore((state) => state.notify)
  const {
    nodes,
    loading,
    root,
    expanded,
    touched,
    flashing,
    hideHidden,
    hideGitignored,
    load,
    refresh,
    toggle,
    expandAll,
    collapseAll,
    setHideHidden,
    setHideGitignored,
    openPreview,
    createEntry,
    renameEntry,
    deleteEntry,
  } = useFilesStore()

  const project = projects.find((item) => item.id === projectId) ?? null
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TreeNode | null>(null)
  const [dragging, setDragging] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const treeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [menu])

  const displayedNodes = useMemo(() => filterTree(nodes, searchQuery), [nodes, searchQuery])

  const paths = useMemo(() => {
    const set = new Set(expanded ? Object.keys(expanded).filter((key) => expanded[key]) : [])
    if (searchQuery.trim()) {
      collectDirPaths(displayedNodes, set)
    }
    return set
  }, [expanded, searchQuery, displayedNodes])

  const handleContextMenu = useCallback((event: MouseEvent, node: TreeNode | null) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ x: event.clientX, y: event.clientY, node })
  }, [])

  const handleFileClick = (node: TreeNode) => {
    if (node.type === 'dir') toggle(node.path)
    else void openPreview(node.path)
  }

  const submitDialog = async () => {
    if (!dialog) return
    const value = dialog.value.trim().replace(/^[/\\]+/, '')
    if (!value) return
    try {
      if (dialog.mode === 'rename' && dialog.node) {
        const parent = dialog.node.path.includes('/')
          ? `${dialog.node.path.slice(0, dialog.node.path.lastIndexOf('/'))}/`
          : ''
        await renameEntry(dialog.node.path, `${parent}${value}`)
      } else {
        const base = dialog.parent ? `${dialog.parent.replace(/\/+$/, '')}/` : ''
        await createEntry(`${base}${value}`, dialog.mode === 'create-dir' ? 'dir' : 'file')
      }
      setDialog(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const confirmRemove = async () => {
    if (!confirmDelete) return
    try {
      await deleteEntry(confirmDelete.path)
      setConfirmDelete(null)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const copyPath = async (node: TreeNode) => {
    try {
      await navigator.clipboard.writeText(node.path)
      notify('Путь скопирован', 'success')
    } catch {
      notify('Не удалось скопировать путь', 'error')
    }
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!projectId) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    let imported = 0
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        notify(`«${file.name}» больше 2 МБ — пропущен`, 'error')
        continue
      }
      try {
        const text = await file.text()
        await api.fs.create(projectId, file.name, 'file', text)
        imported++
      } catch (error) {
        notify(`Не удалось добавить «${file.name}»: ${error instanceof Error ? error.message : String(error)}`, 'error')
      }
    }
    if (imported > 0) {
      notify(`Добавлено файлов: ${imported}`, 'success')
      void refresh()
    }
  }

  return (
    <div className="flex h-full flex-col" onContextMenu={(event) => handleContextMenu(event, null)}>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-[12px] font-medium text-primary" title={root || project?.root_path}>
            {project?.name ?? 'Проект'}
          </div>
          <div className="truncate text-[10px] text-faint" title={project?.root_path}>
            {project ? shortPath(project.root_path, 34) : 'папка не выбрана'}
          </div>
        </div>
        <button
          className="icon-btn"
          title="Новый файл"
          disabled={!projectId}
          onClick={() => setDialog({ mode: 'create-file', value: '', parent: '' })}
        >
          <FilePlus size={14} />
        </button>
        <button
          className="icon-btn"
          title="Новая папка"
          disabled={!projectId}
          onClick={() => setDialog({ mode: 'create-dir', value: '', parent: '' })}
        >
          <FolderPlus size={14} />
        </button>
        <button className="icon-btn" title="Обновить" onClick={() => projectId && void load(projectId)}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
        <button className="icon-btn" title="Свернуть всё" onClick={collapseAll}>
          <ChevronsDownUp size={14} />
        </button>
        <button
          className={cn('icon-btn', hideGitignored && 'text-accent')}
          title={hideGitignored ? 'Показать файлы из .gitignore' : 'Скрыть файлы из .gitignore'}
          onClick={() => setHideGitignored(!hideGitignored)}
        >
          <GitBranch size={14} />
        </button>
        <button
          className={cn('icon-btn', hideHidden && 'text-accent')}
          title={hideHidden ? 'Показать скрытые файлы' : 'Скрыть скрытые файлы'}
          onClick={() => setHideHidden(!hideHidden)}
        >
          <EyeOff size={14} />
        </button>
        <button
          className={cn('icon-btn', showSearch && 'text-accent')}
          title="Поиск файлов"
          onClick={() => {
            setShowSearch(!showSearch)
            if (showSearch) setSearchQuery('')
          }}
        >
          <Search size={14} />
        </button>
      </div>

      {showSearch && (
        <div className="relative border-b border-border px-2 py-1">
          <Search size={11} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            data-testid="file-search-input"
            autoFocus
            className="h-6 w-full rounded border border-border bg-base pl-6 pr-2 text-[11px] text-primary outline-none placeholder:text-faint focus:border-[#3a3a46]"
            placeholder="поиск файлов…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      )}

      <div
        ref={treeRef}
        className={cn(
          'min-h-0 flex-1 overflow-auto py-1 transition-colors',
          dragging && 'bg-active/60 ring-1 ring-inset ring-accent/40',
        )}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {!projectId && (
          <Empty
            compact
            icon={Folder}
            title="Папка не выбрана"
            description="Подключите папку проекта, чтобы агенты могли работать с файлами."
          />
        )}
        {projectId && nodes.length === 0 && !loading && (
          <Empty compact icon={File} title="Пустая папка" description="Создайте файл или перетащите его сюда." />
        )}
        {projectId && nodes.length > 0 && displayedNodes.length === 0 && searchQuery && (
          <div className="py-6 text-center text-[11px] text-faint">Ничего не найдено</div>
        )}
        {loading && nodes.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-faint">
            <Spinner size={12} /> читаю дерево…
          </div>
        )}
        <TreeLevel
          nodes={displayedNodes}
          level={0}
          expanded={paths}
          touched={touched}
          flashing={flashing}
          onToggle={toggle}
          onOpen={handleFileClick}
          onContext={handleContextMenu}
        />
      </div>

      {menu && (
        <div
          className="fade-in fixed z-[70] min-w-[190px] rounded-md border border-border bg-elevated py-1 text-[12px]"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 240) }}
          onClick={(event) => event.stopPropagation()}
        >
          {menu.node?.type === 'file' && (
            <MenuItem
              icon={FileText}
              label="Открыть"
              onClick={() => {
                void openPreview(menu.node!.path)
                setMenu(null)
              }}
            />
          )}
          {menu.node && (
            <>
              <MenuItem
                icon={Pencil}
                label="Переименовать"
                onClick={() => {
                  setDialog({ mode: 'rename', node: menu.node, value: menu.node!.name })
                  setMenu(null)
                }}
              />
              <MenuItem
                icon={Trash2}
                label="Удалить"
                danger
                onClick={() => {
                  setConfirmDelete(menu.node)
                  setMenu(null)
                }}
              />
              <MenuItem
                icon={Copy}
                label="Копировать путь"
                onClick={() => {
                  void copyPath(menu.node!)
                  setMenu(null)
                }}
              />
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <MenuItem
            icon={FilePlus}
            label="Новый файл"
            onClick={() => {
              setDialog({
                mode: 'create-file',
                value: '',
                parent: menu.node?.type === 'dir' ? menu.node.path : '',
              })
              setMenu(null)
            }}
          />
          <MenuItem
            icon={FolderPlus}
            label="Новая папка"
            onClick={() => {
              setDialog({
                mode: 'create-dir',
                value: '',
                parent: menu.node?.type === 'dir' ? menu.node.path : '',
              })
              setMenu(null)
            }}
          />
          <MenuItem
            icon={RefreshCw}
            label="Обновить дерево"
            onClick={() => {
              void refresh()
              setMenu(null)
            }}
          />
          <MenuItem
            icon={ChevronsDownUp}
            label="Раскрыть всё"
            onClick={() => {
              expandAll()
              setMenu(null)
            }}
          />
        </div>
      )}

      <Modal
        open={Boolean(dialog)}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === 'rename'
            ? 'Переименовать'
            : dialog?.mode === 'create-dir'
              ? 'Новая папка'
              : 'Новый файл'
        }
        subtitle={dialog?.parent ? `в ${dialog.parent}` : 'в корне проекта'}
        width={420}
        footer={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              Отмена
            </button>
            <button className="btn btn-primary" onClick={() => void submitDialog()} disabled={!dialog?.value.trim()}>
              {dialog?.mode === 'rename' ? 'Переименовать' : 'Создать'}
            </button>
          </>
        }
      >
        <input
          autoFocus
          className="input"
          value={dialog?.value ?? ''}
          placeholder={dialog?.mode === 'create-dir' ? 'components' : 'index.ts'}
          onChange={(event) => setDialog((current) => (current ? { ...current, value: event.target.value } : current))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitDialog()
          }}
        />
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Удалить?"
        subtitle={confirmDelete?.path}
        width={400}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(null)}>
              Отмена
            </button>
            <button className="btn btn-danger" onClick={() => void confirmRemove()}>
              Переместить в корзину
            </button>
          </>
        }
      >
        <p className="text-[12px] leading-5 text-dim">
          Объект будет перемещён в <span className="mono">.maestro_trash</span> внутри проекта — его можно
          восстановить вручную.
        </p>
      </Modal>
    </div>
  )
}

function TreeLevel({
  nodes,
  level,
  expanded,
  touched,
  flashing,
  onToggle,
  onOpen,
  onContext,
}: {
  nodes: TreeNode[]
  level: number
  expanded: Set<string>
  touched: Record<string, 'created' | 'modified' | 'deleted'>
  flashing: Record<string, number>
  onToggle: (path: string) => void
  onOpen: (node: TreeNode) => void
  onContext: (event: MouseEvent, node: TreeNode | null) => void
}) {
  return (
    <>
      {nodes.map((node) => {
        const isOpen = expanded.has(node.path)
        return (
          <div key={node.path}>
            <div
              className={cn(
                'group flex h-[24px] cursor-pointer items-center gap-1.5 pr-2 text-[12px] hover:bg-elevated',
                node.hidden && 'opacity-55',
                Boolean(flashing[node.path]) && 'file-flash',
              )}
              style={{ paddingLeft: 6 + level * 12 }}
              onClick={() => onOpen(node)}
              onContextMenu={(event) => onContext(event, node)}
              title={node.path}
            >
              {node.type === 'dir' ? (
                <ChevronRight
                  size={12}
                  className={cn('shrink-0 text-faint transition-transform', isOpen && 'rotate-90')}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggle(node.path)
                  }}
                />
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <NodeIcon node={node} open={isOpen} />
              <span className="truncate text-dim group-hover:text-primary">{node.name}</span>
              {touched[node.path] && <TouchMark kind={touched[node.path]!} />}
            </div>
            {node.type === 'dir' && isOpen && node.children && (
              <TreeLevel
                nodes={node.children}
                level={level + 1}
                expanded={expanded}
                touched={touched}
                flashing={flashing}
                onToggle={onToggle}
                onOpen={onOpen}
                onContext={onContext}
              />
            )}
          </div>
        )
      })}
    </>
  )
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof File
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-active',
        danger ? 'text-danger' : 'text-dim hover:text-primary',
      )}
      onClick={onClick}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

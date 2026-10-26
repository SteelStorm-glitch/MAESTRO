import { useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { ChevronUp, TriangleAlert } from 'lucide-react'
import { useAppStore } from './store/app'
import { useFilesStore } from './store/files'
import { useSessionStore } from './store/session'
import { TopBar } from './components/TopBar'
import { Sidebar } from './components/Sidebar'
import { Timeline } from './components/session/Timeline'
import { AgentList } from './components/inspector/AgentList'
import { ConsolePanel } from './components/console/ConsolePanel'
import { FilePreview } from './components/files/FilePreview'
import { ProjectDialog } from './components/files/ProjectDialog'
import { ToastHost } from './components/common/ToastHost'
import { Spinner } from './components/common/Spinner'

export default function App() {
  const {
    booted,
    serverOnline,
    projectId,
    sessionId,
    bootstrap,
    tab,
    projectDialogOpen,
    setProjectDialogOpen,
  } = useAppStore()
  const [consoleCollapsed, setConsoleCollapsed] = useState(false)
  const consoleRef = useRef<ImperativePanelHandle>(null)
  const bootedRef = useRef(false)

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (!projectId) return
    const files = useFilesStore.getState()
    void files.load(projectId)
    const cleanup = files.watch(projectId)
    return () => cleanup()
  }, [projectId])

  useEffect(() => {
    const store = useSessionStore.getState()
    if (sessionId) void store.connect(sessionId)
    else store.disconnect()
  }, [sessionId])

  useEffect(() => {
    if (tab === 'files' && projectId) void useFilesStore.getState().refresh()
  }, [tab, projectId])

  if (!booted) {
    return (
      <div className="flex h-screen items-center justify-center bg-base">
        <div className="flex items-center gap-2 text-[13px] text-dim">
          <Spinner size={15} /> Запуск MAESTRO…
        </div>
      </div>
    )
  }

  if (!serverOnline) {
    return (
      <div className="flex h-screen items-center justify-center bg-base">
        <div className="max-w-[420px] rounded-md border border-border bg-panel px-6 py-6 text-center">
          <TriangleAlert size={22} className="mx-auto mb-3 text-danger" />
          <div className="text-[14px] font-medium text-primary">Сервер недоступен</div>
          <p className="mt-1.5 text-[12px] leading-5 text-dim">
            Запустите <span className="mono">pnpm dev</span> в корне проекта. Интерфейс подключится автоматически.
          </p>
          <button className="btn btn-primary mt-4" onClick={() => void useAppStore.getState().bootstrap()}>
            Повторить
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-w-[1280px] flex-col overflow-hidden bg-base">
      <TopBar />
      <div className="min-h-0 flex-1">
        <PanelGroup direction="vertical">
          <Panel defaultSize={72} minSize={35}>
            <PanelGroup direction="horizontal">
              <Panel defaultSize={20} minSize={13} maxSize={32} collapsible collapsedSize={0}>
                <Sidebar />
              </Panel>
              <PanelResizeHandle className="resizable-handle w-px" />
              <Panel minSize={35}>
                <Timeline />
              </Panel>
              <PanelResizeHandle className="resizable-handle w-px" />
              <Panel defaultSize={19} minSize={13} maxSize={30} collapsible collapsedSize={0}>
                <div className="h-full overflow-hidden border-l border-border bg-panel">
                  <AgentList />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="resizable-handle h-px" />
          <Panel
            ref={consoleRef}
            defaultSize={28}
            minSize={12}
            collapsible
            collapsedSize={3}
            onCollapse={() => setConsoleCollapsed(true)}
            onExpand={() => setConsoleCollapsed(false)}
          >
            <ConsolePanel
              onCollapse={() => {
                consoleRef.current?.collapse()
              }}
            />
          </Panel>
        </PanelGroup>
      </div>

      {consoleCollapsed && (
        <button
          className="fixed bottom-2 right-3 z-30 flex items-center gap-1 rounded border border-border bg-elevated px-2 py-1 text-[10px] text-dim hover:text-primary"
          onClick={() => consoleRef.current?.expand()}
        >
          <ChevronUp size={11} /> Консоль
        </button>
      )}

      <FilePreview />
      <ProjectDialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} />
      <ToastHost />
    </div>
  )
}

'use strict'

const { app, BrowserWindow, Menu, dialog, shell } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
const path = require('node:path')

const isDev = !app.isPackaged
const APP_TITLE = 'MAESTRO — AI Orchestra'

app.setName('MAESTRO')
if (!isDev) app.setPath('userData', path.join(app.getPath('appData'), 'MAESTRO'))

let mainWindow = null
let serverProcess = null
let serverPort = 0
let dataDir = ''
let quitting = false
let serverReady = false
const outputTail = []

/* ------------------------------------------------------------------ paths */

function layout() {
  if (isDev) {
    const repo = path.resolve(__dirname, '..', '..')
    return {
      nodeExe: process.env.MAESTRO_NODE || 'node',
      serverDir: path.join(repo, 'apps', 'server'),
      serverEntry: path.join(repo, 'apps', 'server', 'dist', 'index.js'),
      webDir: path.join(repo, 'apps', 'web', 'dist'),
      icon: path.join(__dirname, 'build', 'icon.ico'),
    }
  }
  return {
    nodeExe: path.join(process.resourcesPath, 'runtime', 'node.exe'),
    // node_modules must stay nested: electron-builder strips a top-level one
    serverDir: path.join(process.resourcesPath, 'server', 'app'),
    serverEntry: path.join(process.resourcesPath, 'server', 'app', 'dist', 'index.js'),
    webDir: path.join(process.resourcesPath, 'web'),
    icon: path.join(process.resourcesPath, 'icon.ico'),
  }
}

/**
 * Portable build keeps its database next to the .exe so the whole thing can be
 * carried on a flash drive. Falls back to %APPDATA% when the folder is read-only.
 */
function pickDataDir() {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  if (portableDir) {
    const candidate = path.join(portableDir, 'MAESTRO-data')
    try {
      fs.mkdirSync(candidate, { recursive: true })
      fs.accessSync(candidate, fs.constants.W_OK)
      return candidate
    } catch {
      /* fall through to userData */
    }
  }
  if (isDev) {
    const dir = path.resolve(__dirname, '..', '..', '.maestro-desktop')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }
  const dir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/* ------------------------------------------------------------------- port */

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('Не удалось выбрать свободный порт'))))
    })
  })
}

function checkHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs },
      (response) => {
        response.resume()
        resolve(response.statusCode === 200)
      },
    )
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
  })
}

async function waitForServer(port, timeoutMs = 60000) {
  const started = Date.now()
  for (;;) {
    if (serverProcess && serverProcess.exitCode !== null) return false
    if (await checkHealth(port)) return true
    if (Date.now() - started > timeoutMs) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/* ----------------------------------------------------------------- server */

function recordOutput(chunk) {
  const text = chunk.toString('utf8')
  outputTail.push(text)
  while (outputTail.length > 120) outputTail.shift()
}

function serverLogTail() {
  return outputTail.join('').split(/\r?\n/).slice(-25).join('\n').trim()
}

async function startServer() {
  const { nodeExe, serverEntry, serverDir, webDir } = layout()

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Не найден серверный бандл: ${serverEntry}`)
  }

  serverPort = await findFreePort()
  dataDir = pickDataDir()

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.MAESTRO_DB
  Object.assign(env, {
    NODE_ENV: 'production',
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    MAESTRO_HOME: dataDir,
    MAESTRO_WEB_DIST: webDir,
  })

  serverProcess = spawn(nodeExe, [serverEntry], {
    cwd: serverDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess.stdout?.on('data', recordOutput)
  serverProcess.stderr?.on('data', recordOutput)
  serverProcess.on('error', (error) => recordOutput(`spawn error: ${error.message}\n`))
  serverProcess.on('exit', (code) => {
    recordOutput(`server exited with code ${code}\n`)
    if (quitting || !serverReady) return
    dialog.showErrorBox(
      'MAESTRO — сервер остановился',
      `Сервер завершился с кодом ${code ?? 'неизвестно'}.\n\n` +
        `Лог: ${path.join(dataDir, 'maestro.log')}\n\n${serverLogTail()}`,
    )
    app.quit()
  })

  const healthy = await waitForServer(serverPort)
  if (!healthy) {
    throw new Error(
      `Сервер не ответил за 60 секунд.\n\nЛог: ${path.join(dataDir, 'maestro.log')}\n\n${serverLogTail()}`,
    )
  }

  serverReady = true
  try {
    fs.writeFileSync(
      path.join(dataDir, 'desktop.json'),
      JSON.stringify({ port: serverPort, pid: serverProcess.pid, started_at: new Date().toISOString() }, null, 2),
    )
  } catch {
    /* diagnostics only */
  }
}

function stopServer() {
  const child = serverProcess
  serverProcess = null
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    // `process.on('exit')` only allows synchronous work, so use spawnSync here.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}

/* ----------------------------------------------------------------- window */

const SPLASH = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0;background:#0A0A0B;color:#F4F4F5;font-family:Inter,system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;user-select:none}
.box{text-align:center}
.logo{font-size:40px;letter-spacing:.32em;font-weight:600;margin-left:.32em;color:#F4F4F5}
.sub{margin-top:10px;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#8B8BF5}
.bar{width:180px;height:2px;margin:28px auto 0;background:#1E1E22;overflow:hidden;border-radius:2px}
.bar i{display:block;width:40%;height:100%;background:#8B8BF5;animation:run 1.1s ease-in-out infinite}
@keyframes run{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
</style></head><body><div class="box"><div class="logo">MAESTRO</div><div class="sub">AI Orchestra</div>
<div class="bar"><i></i></div></div></body></html>`

function createWindow() {
  const { icon } = layout()
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#0A0A0B',
    autoHideMenuBar: true,
    show: false,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  void mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH))
}

function isLocalUrl(url) {
  try {
    const parsed = new URL(url)
    return (
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
      (parsed.port === String(serverPort) || parsed.port === '')
    )
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Вид',
        submenu: [
          { role: 'reload', label: 'Перезагрузить' },
          { role: 'toggleDevTools', label: 'Инструменты разработчика' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Масштаб 100%' },
          { role: 'zoomIn', label: 'Увеличить' },
          { role: 'zoomOut', label: 'Уменьшить' },
        ],
      },
    ]),
  )
  mainWindow?.setMenuBarVisibility(false)

  createWindow()

  try {
    await startServer()
  } catch (error) {
    quitting = true
    stopServer()
    const message = error instanceof Error ? error.message : String(error)
    dialog.showErrorBox('MAESTRO — не удалось запустить', message)
    app.quit()
    return
  }

  if (!mainWindow) return
  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(boot).catch((error) => {
    dialog.showErrorBox('MAESTRO — ошибка запуска', error instanceof Error ? error.stack ?? error.message : String(error))
    app.quit()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    stopServer()
  })
  process.on('exit', stopServer)
}

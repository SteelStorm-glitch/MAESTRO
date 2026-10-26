#!/usr/bin/env node
/**
 * Builds a portable Windows .exe:
 *   1. bundles web + server
 *   2. deploys a self-contained server folder (flat node_modules)
 *   3. bundles the current Node runtime (native modules match its ABI)
 *   4. lets electron-builder wrap everything into one portable executable
 */
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stage = path.join(root, 'build', 'portable-staging')
// Electron-builder drops a *root* node_modules folder from extraResources, so the
// deployed server lives one level deeper: server/app/{dist,node_modules}.
const stageServer = path.join(stage, 'server', 'app')
const stageWeb = path.join(stage, 'web')
const stageRuntime = path.join(stage, 'runtime')

const started = Date.now()

function step(label) {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`\n\u001b[35m▸ ${label}\u001b[0m \u001b[90m(+${elapsed}s)\u001b[0m`)
}

function run(command, cwd = root, extraEnv = {}) {
  execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } })
}

function quote(value) {
  // pnpm resolves a backslash Windows path as package-relative; forward slashes stay absolute.
  const normalized = value.replace(/\\/g, '/')
  return `"${normalized.replace(/"/g, '\\"')}"`
}

function remove(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
}

function pruneServerBundle() {
  const modules = path.join(stageServer, 'node_modules')
  const drop = [
    'src',
    'tsconfig.json',
    'tsup.config.ts',
    'node_modules/.pnpm',
    'node_modules/.bin',
    'node_modules/@maestro',
    'node_modules/@types',
    'node_modules/better-sqlite3/deps',
    'node_modules/better-sqlite3/src',
    'node_modules/better-sqlite3/build/Release/obj',
    'node_modules/node-pty/deps',
    'node_modules/node-pty/src',
    'node_modules/node-pty/third_party',
    'node_modules/node-pty/scripts',
    'node_modules/node-pty/typings',
    'node_modules/node-pty/prebuilds/darwin-arm64',
    'node_modules/node-pty/prebuilds/darwin-x64',
    'node_modules/node-pty/prebuilds/win32-arm64',
  ]
  for (const entry of drop) remove(path.join(stageServer, entry))
  for (const dir of [path.join(stageServer, 'dist'), modules]) {
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith('.map')) remove(path.join(dir, file))
    }
  }
}

function verifyNativeSqlite() {
  const nodeExe = path.join(stageRuntime, 'node.exe')
  const sqlitePath = path.join(stageServer, 'node_modules', 'better-sqlite3')
  const script =
    `const Database = require(${JSON.stringify(sqlitePath)});` +
    `const db = new Database(':memory:');` +
    `db.prepare('select 1 as ok').get();` +
    `db.close();` +
    `console.log('better-sqlite3 ok, abi=' + process.versions.modules)`
  execFileSync(nodeExe, ['-e', script], { stdio: 'inherit' })
}

step('Сборка web')
run('pnpm --filter @maestro/web build')

step('Сборка server')
run('pnpm --filter @maestro/server build')

step('Подготовка staging-каталога')
remove(stage)
fs.mkdirSync(stageServer, { recursive: true })
fs.mkdirSync(stageWeb, { recursive: true })
fs.mkdirSync(stageRuntime, { recursive: true })

step('Упаковка standalone-сервера (pnpm deploy)')
// Deploy outside the repo: pnpm would otherwise pack the in-repo staging folder into itself.
const deployTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-deploy-'))
run(
  `pnpm --filter @maestro/server deploy --prod --legacy --config.node-linker=hoisted ${quote(deployTmp)}`,
)
fs.cpSync(deployTmp, stageServer, { recursive: true, dereference: true })
fs.rmSync(deployTmp, { recursive: true, force: true })

step('Копирование интерфейса и Node runtime')
fs.cpSync(path.join(root, 'apps', 'web', 'dist'), stageWeb, { recursive: true })
fs.copyFileSync(process.execPath, path.join(stageRuntime, 'node.exe'))

step('Очистка лишних файлов')
pruneServerBundle()

step('Проверка нативного SQLite')
verifyNativeSqlite()

if (process.env.MAESTRO_SKIP_PACKAGING === '1') {
  console.log('\n\u001b[33m• electron-builder пропущен (MAESTRO_SKIP_PACKAGING=1)\u001b[0m')
  process.exit(0)
}

step('Сборка приложения (electron-builder)')
run(
  'pnpm --filter @maestro/desktop exec electron-builder --win dir --publish never',
  path.join(root, 'apps', 'desktop'),
  { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
)

step('Сборка portable-лаунчера (NSIS, ~3 мин)')
const version = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'desktop', 'package.json'), 'utf8')).version
const appDir = path.join(root, 'release', 'win-unpacked')
const artifact = path.join(root, 'release', `MAESTRO-${version}-portable.exe`)
const nsiPath = path.join(root, 'build', 'portable.nsi')

function findMakensis() {
  if (process.env.MAKENSIS) return process.env.MAKENSIS
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
    'electron-builder',
    'Cache',
    'nsis',
  )
  if (fs.existsSync(cacheRoot)) {
    for (const entry of fs.readdirSync(cacheRoot)) {
      if (!entry.startsWith('nsis-')) continue
      const candidate = path.join(cacheRoot, entry, 'Bin', 'makensis.exe')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error('makensis.exe не найден. Задайте MAKENSIS или установите NSIS.')
}

function ensureMakensis() {
  try {
    return findMakensis()
  } catch {
    console.log('  NSIS не найден — скачиваю его через electron-builder (разово)…')
    run(
      'pnpm --filter @maestro/desktop exec electron-builder --win nsis --publish never',
      path.join(root, 'apps', 'desktop'),
      { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    )
    return findMakensis()
  }
}

const [major, minor, patch] = version.split('.').map(Number)
const nsi = `Unicode true
Name "MAESTRO"
Caption "MAESTRO — первый запуск"
OutFile "${artifact}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
AutoCloseWindow true
ShowInstDetails nevershow
Icon "${path.join(root, 'apps', 'desktop', 'build', 'icon.ico')}"
VIProductVersion "${major}.${minor}.${patch}.0"
VIAddVersionKey /LANG=1049 "ProductName" "MAESTRO"
VIAddVersionKey /LANG=1049 "LegalCopyright" "MAESTRO"
VIAddVersionKey /LANG=1049 "FileDescription" "MAESTRO — AI Orchestra"
VIAddVersionKey /LANG=1049 "FileVersion" "${version}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${version}"

Page instfiles

Section "Launcher"
  SetShellVarContext current
  StrCpy $0 "$LOCALAPPDATA\\MAESTRO\\runtime-${version}"
  IfFileExists "$0\\.ready" Launch
  RMDir /r "$0"
  CreateDirectory "$0"
  SetOutPath "$0"
  File /r "${appDir}\\*.*"
  FileOpen $1 "$0\\.ready" w
  FileWrite $1 "${version}"
  FileClose $1

Launch:
  System::Call 'kernel32::SetEnvironmentVariable(t "PORTABLE_EXECUTABLE_DIR", t "$EXEDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", i 0)'
  Exec '"$0\\MAESTRO.exe"'
SectionEnd
`
fs.writeFileSync(nsiPath, nsi, 'utf8')
execFileSync(ensureMakensis(), ['/V2', nsiPath], { cwd: root, stdio: 'inherit' })
if (fs.existsSync(artifact)) {
  const mb = (fs.statSync(artifact).size / 1024 / 1024).toFixed(1)
  console.log(`\n\u001b[32m✓ Готово: ${artifact} (${mb} МБ)\u001b[0m`)
  console.log(`  Данные приложения: папка MAESTRO-data рядом с .exe`)
} else {
  console.error('\n\u001b[31m✗ Артефакт не найден в release/\u001b[0m')
  process.exit(1)
}

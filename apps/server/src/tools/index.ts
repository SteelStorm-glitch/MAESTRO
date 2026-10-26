import type { Role, ToolDefinition } from '@maestro/shared'
import { fsAppend, fsDelete, fsList, fsMove, fsRead, fsWrite, type ToolContext } from './fs'
import { fsSearch } from './search'
import { runShell } from './shell'
import { assertCommandSafe, GuardError } from './guard'
import { gitDiff, gitLog, gitStatus } from './git'
import { bus } from '../events/bus'

export type ToolName =
  | 'fs_list'
  | 'fs_read'
  | 'fs_search'
  | 'fs_write'
  | 'fs_append'
  | 'fs_move'
  | 'fs_delete'
  | 'shell_exec'
  | 'git_status'
  | 'git_diff'
  | 'git_log'

export interface ToolSpec {
  name: ToolName
  permission: 'read' | 'write' | 'shell'
  label: string
  definition: ToolDefinition
}

const schema = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
})

export const TOOL_CATALOG: Record<ToolName, ToolSpec> = {
  fs_list: {
    name: 'fs_list',
    permission: 'read',
    label: 'Список файлов',
    definition: {
      name: 'fs_list',
      description:
        'Показать дерево каталога проекта. Путь relative to project root. По умолчанию глубина 2.',
      parameters: schema({
        path: { type: 'string', description: 'Путь относительно корня проекта (по умолчанию ".")' },
        depth: { type: 'integer', minimum: 0, maximum: 5, description: 'Глубина рекурсии' },
      }),
    },
  },
  fs_read: {
    name: 'fs_read',
    permission: 'read',
    label: 'Чтение файла',
    definition: {
      name: 'fs_read',
      description:
        'Прочитать текстовый файл проекта. Для больших файлов используйте offset/limit (байты) и next_offset из ответа.',
      parameters: schema(
        {
          path: { type: 'string', description: 'Путь относительно корня проекта' },
          offset: { type: 'integer', minimum: 0, description: 'Смещение в байтах' },
          limit: { type: 'integer', minimum: 1, maximum: 262144, description: 'Сколько байт прочитать (по умолчанию 65536)' },
        },
        ['path'],
      ),
    },
  },
  fs_search: {
    name: 'fs_search',
    permission: 'read',
    label: 'Поиск по коду',
    definition: {
      name: 'fs_search',
      description: 'Поиск по содержимому файлов проекта (regex). Возвращает строки вида path:line: text.',
      parameters: schema(
        {
          pattern: { type: 'string', description: 'Регулярное выражение или подстрока' },
          glob: { type: 'string', description: 'Фильтр файлов, например "*.ts"' },
          path: { type: 'string', description: 'Каталог для поиска относительно корня проекта' },
          max_results: { type: 'integer', minimum: 1, maximum: 500 },
          ignore_case: { type: 'boolean' },
        },
        ['pattern'],
      ),
    },
  },
  fs_write: {
    name: 'fs_write',
    permission: 'write',
    label: 'Запись файла',
    definition: {
      name: 'fs_write',
      description: 'Создать или полностью перезаписать файл в проекте. Родительские папки создаются автоматически.',
      parameters: schema(
        {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        ['path', 'content'],
      ),
    },
  },
  fs_append: {
    name: 'fs_append',
    permission: 'write',
    label: 'Дописать файл',
    definition: {
      name: 'fs_append',
      description: 'Дописать текст в конец файла (создаёт файл, если его нет).',
      parameters: schema({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
    },
  },
  fs_move: {
    name: 'fs_move',
    permission: 'write',
    label: 'Перемещение',
    definition: {
      name: 'fs_move',
      description: 'Переименовать или переместить файл/папку внутри проекта.',
      parameters: schema(
        {
          from: { type: 'string' },
          to: { type: 'string' },
          overwrite: { type: 'boolean' },
        },
        ['from', 'to'],
      ),
    },
  },
  fs_delete: {
    name: 'fs_delete',
    permission: 'write',
    label: 'Удаление',
    definition: {
      name: 'fs_delete',
      description: 'Удалить файл или папку. Объект перемещается в .maestro_trash, не удаляется безвозвратно.',
      parameters: schema({ path: { type: 'string' } }, ['path']),
    },
  },
  shell_exec: {
    name: 'shell_exec',
    permission: 'shell',
    label: 'Терминал',
    definition: {
      name: 'shell_exec',
      description:
        'Выполнить команду оболочки в корне проекта. Возвращает stdout+stderr и код выхода. Не используйте интерактивные команды.',
      parameters: schema(
        {
          command: { type: 'string', description: 'Команда для shell' },
          cwd: { type: 'string', description: 'Рабочий каталог относительно корня проекта' },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000 },
        },
        ['command'],
      ),
    },
  },
  git_status: {
    name: 'git_status',
    permission: 'read',
    label: 'Git status',
    definition: {
      name: 'git_status',
      description: 'Показать git status --porcelain проекта.',
      parameters: schema({}),
    },
  },
  git_diff: {
    name: 'git_diff',
    permission: 'read',
    label: 'Git diff',
    definition: {
      name: 'git_diff',
      description: 'Показать git diff (можно по конкретному пути или staged).',
      parameters: schema({
        path: { type: 'string' },
        staged: { type: 'boolean' },
      }),
    },
  },
  git_log: {
    name: 'git_log',
    permission: 'read',
    label: 'Git log',
    definition: {
      name: 'git_log',
      description: 'Последние 15 коммитов (oneline).',
      parameters: schema({}),
    },
  },
}

export const ALL_TOOL_NAMES = Object.keys(TOOL_CATALOG) as ToolName[]

const PERMISSION_RANK: Record<Role['permission'], number> = { read: 1, write: 2, admin: 3 }

/** Which tools this role may call at all (before per-call checks like shell mode). */
export function allowedToolsForRole(role: Role): ToolName[] {
  const rank = PERMISSION_RANK[role.permission] ?? 1
  const explicit = new Set(role.tools)
  return ALL_TOOL_NAMES.filter((name) => {
    const spec = TOOL_CATALOG[name]
    if (spec.permission === 'shell') {
      return rank >= 2 && role.shell_mode !== 'off' && explicit.has(name)
    }
    if (spec.permission === 'write' && rank < 2) return false
    // Empty tools list means "everything the permission allows" except shell.
    if (explicit.size === 0) return true
    return explicit.has(name)
  })
}

export function toolDefinitionsForRole(role: Role): ToolDefinition[] {
  return allowedToolsForRole(role).map((name) => TOOL_CATALOG[name].definition)
}

export interface ToolExecutionResult {
  ok: boolean
  content: string
  duration_ms: number
}

export async function executeTool(
  ctx: ToolContext,
  role: Role,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const started = Date.now()
  const allowed = allowedToolsForRole(role)
  if (!allowed.includes(name as ToolName)) {
    const reason =
      TOOL_CATALOG[name as ToolName]?.permission === 'shell'
        ? 'инструмент shell_exec не разрешён для этой роли (permission/shell_mode/tools)'
        : `инструмент ${name} запрещён политикой роли «${role.name}» (permission=${role.permission})`
    return { ok: false, content: `ERROR [permission_denied]: ${reason}`, duration_ms: Date.now() - started }
  }

  try {
    let content: string
    switch (name as ToolName) {
      case 'fs_list':
        content = fsList(ctx, args as { path?: string; depth?: number })
        break
      case 'fs_read':
        content = fsRead(ctx, args as { path: string; offset?: number; limit?: number })
        break
      case 'fs_search':
        content = await fsSearch(ctx, args as { pattern: string })
        break
      case 'fs_write':
        content = fsWrite(ctx, args as { path: string; content: string })
        break
      case 'fs_append':
        content = fsAppend(ctx, args as { path: string; content: string })
        break
      case 'fs_move':
        content = fsMove(ctx, args as { from: string; to: string; overwrite?: boolean })
        break
      case 'fs_delete':
        content = fsDelete(ctx, args as { path: string })
        break
      case 'shell_exec': {
        const command = String(args.command ?? '')
        if (!command.trim()) throw new GuardError('bad_args', 'Пустая команда')
        assertCommandSafe(command)
        const result = await runShell(ctx, command, {
          timeoutMs: typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
          cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
        })
        content = JSON.stringify({
          command,
          exit_code: result.code,
          timed_out: result.timedOut,
          output: result.output,
        })
        if (result.code !== 0) {
          return { ok: false, content, duration_ms: Date.now() - started }
        }
        break
      }
      case 'git_status':
        content = await gitStatus(ctx)
        break
      case 'git_diff':
        content = await gitDiff(ctx, args as { path?: string; staged?: boolean })
        break
      case 'git_log':
        content = await gitLog(ctx)
        break
      default:
        throw new GuardError('unknown_tool', `Неизвестный инструмент: ${name}`)
    }
    return { ok: true, content, duration_ms: Date.now() - started }
  } catch (error) {
    const code = error instanceof GuardError ? error.code : 'tool_error'
    const message = error instanceof Error ? error.message : String(error)
    bus.emit(ctx.sessionId, 'warn', {
      code,
      message,
      role_id: ctx.roleId,
      role_name: ctx.roleName,
      tool: name,
    })
    return { ok: false, content: `ERROR [${code}]: ${message}`, duration_ms: Date.now() - started }
  }
}

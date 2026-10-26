import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Role } from '@maestro/shared'
import { executeTool } from './index'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-tools-'))

const readOnlyRole: Role = {
  id: 'role-read',
  name: 'Аудитор',
  description: '',
  system_prompt: '',
  model_id: null,
  temperature: 0.2,
  tools: ['fs_list', 'fs_read', 'fs_write', 'shell_exec'],
  permission: 'read',
  shell_mode: 'off',
  color: '#46A758',
  created_at: 0,
}

const writeRole: Role = {
  ...readOnlyRole,
  id: 'role-write',
  name: 'Программист',
  permission: 'write',
  shell_mode: 'auto',
  tools: ['fs_list', 'fs_read', 'fs_write', 'fs_delete', 'shell_exec'],
}

const ctx = { sessionId: 'test-session', projectRoot: root, roleId: 'role-read', roleName: 'Аудитор' }

beforeAll(() => {
  fs.writeFileSync(path.join(root, 'README.md'), '# test\n')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('tool permissions', () => {
  it('blocks fs_write for a read-only role', async () => {
    const result = await executeTool(ctx, readOnlyRole, 'fs_write', { path: 'forbidden.txt', content: 'nope' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('permission_denied')
    expect(fs.existsSync(path.join(root, 'forbidden.txt'))).toBe(false)
  })

  it('blocks shell_exec when shell_mode is off', async () => {
    const result = await executeTool(ctx, readOnlyRole, 'shell_exec', { command: 'echo hi' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('permission_denied')
  })

  it('allows fs_write for a write role', async () => {
    const writeCtx = { ...ctx, roleId: writeRole.id, roleName: writeRole.name }
    const result = await executeTool(writeCtx, writeRole, 'fs_write', { path: 'ok.txt', content: 'hello' })
    expect(result.ok).toBe(true)
    expect(fs.readFileSync(path.join(root, 'ok.txt'), 'utf8')).toBe('hello')
  })

  it('rejects path traversal', async () => {
    const result = await executeTool(ctx, readOnlyRole, 'fs_read', { path: '../../etc/passwd' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('path_escape')
  })

  it('rejects absolute paths outside the project', async () => {
    const outside = path.join(os.tmpdir(), 'maestro-outside-secret.txt')
    fs.writeFileSync(outside, 'secret')
    try {
      const result = await executeTool(ctx, readOnlyRole, 'fs_read', { path: outside })
      expect(result.ok).toBe(false)
      expect(result.content).toContain('path_escape')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('blocks destructive shell commands even for write roles', async () => {
    const writeCtx = { ...ctx, roleId: writeRole.id, roleName: writeRole.name }
    const result = await executeTool(writeCtx, writeRole, 'shell_exec', { command: 'rm -rf /' })
    expect(result.ok).toBe(false)
    expect(result.content).toContain('shell_denied')
  })

  it('moves deleted files to .maestro_trash', async () => {
    fs.writeFileSync(path.join(root, 'trash-me.txt'), 'x')
    const writeCtx = { ...ctx, roleId: writeRole.id, roleName: writeRole.name }
    const result = await executeTool(writeCtx, writeRole, 'fs_delete', { path: 'trash-me.txt' })
    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(root, 'trash-me.txt'))).toBe(false)
    const trash = fs.readdirSync(path.join(root, '.maestro_trash'))
    expect(trash.some((name) => name.includes('trash-me.txt'))).toBe(true)
  })
})

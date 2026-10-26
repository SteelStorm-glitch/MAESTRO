import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertCommandSafe, GuardError, resolveProjectPath } from './guard'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-guard-'))
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-outside-'))

beforeAll(() => {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const a = 1\n')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('path guard', () => {
  it('resolves paths inside the project', () => {
    const resolved = resolveProjectPath(root, 'src/index.ts')
    expect(resolved.endsWith(path.join('src', 'index.ts'))).toBe(true)
  })

  it('rejects parent traversal', () => {
    expect(() => resolveProjectPath(root, '../../etc/passwd')).toThrow(GuardError)
  })

  it('rejects absolute paths outside', () => {
    expect(() => resolveProjectPath(root, path.join(outside, 'secret.txt'))).toThrow(GuardError)
  })

  it('rejects symlinks escaping the project', () => {
    const link = path.join(root, 'escape')
    try {
      fs.symlinkSync(outside, link, 'junction')
    } catch {
      return // Windows without developer mode cannot create symlinks — nothing to test.
    }
    expect(() => resolveProjectPath(root, 'escape/secret.txt')).toThrow(GuardError)
  })

  it('allows the project root itself', () => {
    expect(resolveProjectPath(root, '.')).toBeTruthy()
  })
})

describe('shell denylist', () => {
  it('blocks destructive commands', () => {
    for (const command of ['rm -rf /', 'sudo apt install x', 'mkfs.ext4 /dev/sda', 'shutdown -h now', ':(){ :|:& };:']) {
      expect(() => assertCommandSafe(command), command).toThrow(GuardError)
    }
  })

  it('blocks force pushes and PowerShell wipes', () => {
    for (const command of [
      'git push -f origin main',
      'git push --force',
      'powershell -c "Remove-Item -Recurse -Force .\\src"',
      'del /q /s /f *',
      'rd /s /q *',
    ]) {
      expect(() => assertCommandSafe(command), command).toThrow(GuardError)
    }
  })

  it('allows ordinary commands', () => {
    for (const command of ['npm run build', 'git status', 'git push origin main', 'ls -la src', 'python -m pytest']) {
      expect(() => assertCommandSafe(command), command).not.toThrow()
    }
  })
})

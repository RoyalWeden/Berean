import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Desktop regression guard for the Phase 1/3 service extraction: every channel the preload
 * bridge invokes must still be registered by some main-process handler. A renamed or dropped
 * `ipcMain.handle(...)` would otherwise only surface as a runtime "No handler registered" error
 * in the packaged app.
 */
const ROOT = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

function channels(re: RegExp, src: string): Set<string> {
  const out = new Set<string>()
  for (const m of src.matchAll(re)) out.add(m[1])
  return out
}

describe('preload ↔ main IPC parity', () => {
  const preload = readFileSync(join(ROOT, 'preload.ts'), 'utf8')
  const invoked = channels(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g, preload)

  const handled = new Set<string>()
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8')
    for (const c of channels(/ipc(?:Main)?\.(?:handle|on|once)\(\s*'([^']+)'/g, src)) handled.add(c)
  }

  it('preload invokes a non-trivial number of channels', () => {
    expect(invoked.size).toBeGreaterThan(150)
  })

  it('every channel the preload invokes has a main-process handler', () => {
    const missing = [...invoked].filter((c) => !handled.has(c)).sort()
    expect(missing, `channels invoked by preload with no ipcMain.handle/on: ${missing.join(', ')}`).toEqual([])
  })
})

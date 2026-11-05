import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomicSync } from '../atomicWrite'

describe('writeFileAtomicSync', () => {
  it('replaces a file and leaves nothing behind', () => {
    const d = mkdtempSync(join(tmpdir(), 'berean-atomic-'))
    const f = join(d, 'note.md')
    writeFileSync(f, 'old')
    writeFileAtomicSync(f, 'new')
    expect(readFileSync(f, 'utf8')).toBe('new')
    expect(readdirSync(d)).toEqual(['note.md'])
  })

  it('keeps the old file when the write cannot finish', () => {
    const d = mkdtempSync(join(tmpdir(), 'berean-atomic-'))
    const target = join(d, 'isdir')
    mkdirSync(target)
    writeFileSync(join(target, 'keep'), 'x')
    expect(() => writeFileAtomicSync(target, 'new')).toThrow()
    expect(readdirSync(d)).toEqual(['isdir'])
    expect(readFileSync(join(target, 'keep'), 'utf8')).toBe('x')
  })
})

/**
 * SEP26-SEARCH-001/002 — the app never forces capitalization in a text field: no
 * `autoCapitalize="words" | "characters" | "sentences"` anywhere, and "off"/"none" only on URL
 * fields (a web address is never capitalized — the iOS convention). Every other field follows
 * the user's own iOS keyboard setting.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') files(p, out) }
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('text-input capitalization policy', () => {
  const roots = ['src/mobile', 'src/components']
  const all = roots.flatMap((r) => files(r))

  it('no field forces words / characters / sentences capitalization', () => {
    const offenders = all.filter((f) => /autoCapitalize="(words|characters|sentences)"/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('"off"/"none" appear only on URL inputs', () => {
    const bad: string[] = []
    for (const f of all) {
      const src = readFileSync(f, 'utf8')
      const re = /<input[^>]*autoCapitalize="(off|none)"[^>]*>/gs
      for (const m of src.matchAll(re)) if (!/type="url"/.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 80)}`)
      // Multi-line JSX: the attribute on its own line — check the surrounding element.
      const lines = src.split('\n')
      lines.forEach((l, i) => {
        if (/^\s*autoCapitalize="(off|none)"/.test(l)) {
          const ctx = lines.slice(Math.max(0, i - 6), i + 1).join('\n')
          if (!/type="url"/.test(ctx)) bad.push(`${f}:${i + 1}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})

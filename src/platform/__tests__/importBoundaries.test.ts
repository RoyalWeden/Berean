import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Platform-boundary guard (R136; the repo has no ESLint config, so this is the enforced rule):
 *  - shared code (`src/platform/services`, `src/platform/sync`, `src/platform/db`, `src/lib`,
 *    `src/store`) must not import Electron, Node built-ins or better-sqlite3 — it runs in the
 *    Electron main process, in vitest and inside WKWebView;
 *  - shared renderer code (`src/components`, `src/lib`, `src/store`, `src/hooks`) must not import
 *    the iOS platform layer (`src/platform/ios`) — the phone installs its bridge behind
 *    `window.*`, and `src/lib/platformCapabilities.ts` is the only capability switch;
 *  - the phone shell (`src/mobile`) must not import `electron/`.
 * Allow-listed exceptions carry their reason.
 */
const ROOT = join(__dirname, '..', '..', '..')
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*from\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}
function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const m of src.matchAll(IMPORT_RE)) out.push(m[1] ?? m[2])
  return out
}
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, '/')

const NODE_BUILTINS = /^(node:|fs$|fs\/|path$|os$|crypto$|child_process$|worker_threads$|stream$|http$|https$|net$|url$|zlib$|util$)/

const ALLOW: Record<string, string> = {
  // The iOS-only player placeholder; rendered only when capabilities.nativeVideoPlayer is set.
  'src/components/youtube/TouchYouTubePlayer.tsx': 'iOS native player host (TouchYouTubePlayer) — the one component that talks to a Capacitor plugin directly',
  'src/components/youtube/YouTubeTab.tsx': 'dynamic import of the native player plugin behind capabilities.nativeVideoPlayer',
}

describe('import boundaries', () => {
  it('shared services / sync / db / lib / store never import Electron, Node built-ins or better-sqlite3', () => {
    const files = ['src/platform/services', 'src/platform/sync', 'src/platform/db', 'src/lib', 'src/store'].flatMap((d) => walk(join(ROOT, d)))
    const bad: string[] = []
    for (const f of files) {
      for (const spec of imports(f)) {
        if (spec === 'electron' || spec === 'better-sqlite3' || NODE_BUILTINS.test(spec) || spec.startsWith('electron/') || /(^|\/)electron\//.test(spec)) bad.push(`${rel(f)} → ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('shared renderer code does not import the iOS platform layer', () => {
    const files = ['src/components', 'src/lib', 'src/store', 'src/hooks'].flatMap((d) => walk(join(ROOT, d)))
    const bad: string[] = []
    for (const f of files) {
      const r = rel(f)
      if (ALLOW[r]) continue
      for (const spec of imports(f)) {
        if (/(^@\/platform\/ios|\/platform\/ios)/.test(spec)) bad.push(`${r} → ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the phone shell never imports electron/', () => {
    const files = walk(join(ROOT, 'src/mobile'))
    const bad: string[] = []
    for (const f of files) for (const spec of imports(f)) if (spec === 'electron' || /(^|\/)electron\//.test(spec)) bad.push(`${rel(f)} → ${spec}`)
    expect(bad).toEqual([])
  })
})

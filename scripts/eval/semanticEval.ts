// Manual/report-only end-to-end check of the semantic (embedding) retrieval layer — companion to
// runRetrievalEval.ts, but deliberately NOT folded into it: that harness mocks Ollama entirely
// (see its own header), which means it can never actually exercise embedQuery's real network call
// or measure real latency. This file does the opposite — it hits the REAL local Ollama embedding
// endpoint (electron/embeddings.ts's embedQuery, unmocked) against the REAL, already-built
// electron/db-generated/verse_embeddings.db (via node:sqlite, same betterSqlite3NodeShim.ts
// workaround runRetrievalEval.ts already uses — this worktree's better-sqlite3 native binding is
// Electron-ABI-only, unloadable under plain Node/vitest).
//
// NOT named `*.test.ts` (same convention as runRetrievalEval.ts) — never swept into `npm test`'s
// 3507-test baseline, and it will FAIL to produce useful output if Ollama isn't running or the
// index hasn't been built yet, which is expected/fine for a manual report tool, not something a
// CI gate should ever depend on.
//
// Run with: npx vitest run --config scripts/eval/vitest.eval.config.ts scripts/eval/semanticEval.ts
// (the shared eval vitest config's `include` only lists runRetrievalEval.ts by default — pass this
// file's path explicitly on the command line to also run this one, or edit that config's include
// list if you want both to run together by default.)
import { describe, it, vi, beforeAll } from 'vitest'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir() },
  // Forwards to Node's OWN real global fetch — this is the one place in the whole eval setup that
  // deliberately does NOT mock the network call, since the entire point of this file is measuring
  // the real Ollama round-trip. electron/embeddings.ts calls `net.fetch(url, init)` with the exact
  // same (url, init) shape `fetch` itself takes, so a direct passthrough is a correct shim, not an
  // approximation.
  net: { fetch: (url: string, init: RequestInit) => fetch(url, init) },
  ipcMain: { handle: () => {} },
}))
vi.mock('better-sqlite3', async () => ({ default: (await import('./betterSqlite3NodeShim')).default }))

import { hasEmbeddingIndex, embedQuery, semanticSearch, resetEmbeddingIndexCache } from '../../electron/embeddings'
import { resetEmbeddingsDbCache } from '../../electron/db/embeddingsDb'
import { EVAL_CASES } from './retrievalFixtures'

describe('Semantic embedding retrieval — manual/report-only, real Ollama + real index', () => {
  beforeAll(() => {
    resetEmbeddingsDbCache()
    resetEmbeddingIndexCache()
  })

  it('reports recall + latency for zero-overlap and modern-wording cases against the real index', async () => {
    if (!hasEmbeddingIndex()) {
      console.log('\n=== Semantic eval SKIPPED: no index at electron/db-generated/verse_embeddings.db yet ===')
      console.log('Run: node scripts/build-embedding-index.js')
      return
    }

    const cases = EVAL_CASES.filter((c) => c.category === 'zero-overlap' || c.category === 'modern-wording')
    console.log(`\n=== Semantic retrieval eval (real Ollama + real index) — ${cases.length} cases ===`)

    let hits5 = 0, hits10 = 0
    const latencies: number[] = []
    for (const c of cases) {
      const t0 = Date.now()
      let vec
      try {
        vec = await embedQuery(c.question)
      } catch (e) {
        console.log(`  [ERROR] ${c.id}: embedQuery failed — ${e instanceof Error ? e.message : e} (is Ollama running with nomic-embed-text pulled?)`)
        continue
      }
      const results = semanticSearch(vec, 10)
      const latencyMs = Date.now() - t0
      latencies.push(latencyMs)
      const expectedKeys = new Set(c.expected.map((e) => `${e.textId}|${e.bookId}|${e.chapter}|${e.verse}`))
      const top5 = results?.slice(0, 5).map((r) => `${r.textId}|${r.bookId}|${r.chapter}|${r.verseNum}`) ?? []
      const top10 = results?.map((r) => `${r.textId}|${r.bookId}|${r.chapter}|${r.verseNum}`) ?? []
      const hit5 = top5.some((k) => expectedKeys.has(k))
      const hit10 = top10.some((k) => expectedKeys.has(k))
      if (hit5) hits5++
      if (hit10) hits10++
      const topDisplay = (results ?? []).slice(0, 3).map((r) => `${r.bookId} ${r.chapter}:${r.verseNum}(${r.score.toFixed(2)})`).join(', ')
      console.log(`  [${hit10 ? (hit5 ? 'top5' : 'top10') : 'MISS'}] ${c.id} (${latencyMs}ms) -> ${topDisplay}`)
    }
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1)
    console.log(`\nrecall@5=${(hits5 / cases.length * 100).toFixed(1)}%  recall@10=${(hits10 / cases.length * 100).toFixed(1)}%  avg query latency=${avgLatency.toFixed(0)}ms (embed + brute-force scan)`)
  }, 120_000)
})

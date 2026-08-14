// Berean Chat (AI Lookup) retrieval eval harness — Team B, "measure first, then fix" mandate.
//
// WHY VITEST (a standalone `scripts/` script was the other option the brief offered): vitest
// already solves every piece of infrastructure this needs for free — TypeScript + the `@` path
// alias aiLookup.ts itself depends on (parseRef.ts), and `vi.mock` for swapping out Ollama/
// Electron. A bare Node script would have to reinvent a TS loader, alias resolution, and module
// mocking from scratch for no benefit. The one thing vitest does NOT solve is real SQLite access
// (see betterSqlite3NodeShim.ts's own comment) — solved separately, below, with `node:sqlite`.
//
// WHY THIS FILE IS NOT NAMED `*.test.ts`: vitest's default `include` glob only picks up
// `*.test.*`/`*.spec.*` files, so this deliberately-named-different file is invisible to a bare
// `npx vitest run` / `npm test` — it will NEVER be counted in or perturb the 3470-tests-across-
// 99-files baseline. Run it explicitly and on purpose:
//   npx vitest run scripts/eval/runRetrievalEval.ts
//
// WHAT THIS MEASURES: retrieval + ranking in isolation from Ollama. The `keywords` field on each
// fixture case (see retrievalFixtures.ts) stands in for what a real extraction call would have
// produced — the mocked `runOllamaJson` below returns exactly that (and a harmless no-op verdict
// for the critique/verification/relevance-prune calls), so every run is instant and byte-for-byte
// deterministic. This intentionally does NOT measure whether Ollama itself would produce good
// keywords for a given question — that's a separate, non-deterministic concern the brief
// explicitly said not to make this harness depend on.
//
// Everything else in the pipeline it touches — FTS5 candidate search (bible.ts), cross-ref/TSKE
// lookups (crossrefs.ts), Strong's gloss/occurrence lookups (lexicon.ts), and all of aiLookup.ts's
// own scoring/merging/ranking logic — is the REAL, UNMODIFIED production code, running against
// the REAL data/*.db files via betterSqlite3NodeShim.ts. Only Ollama and the notes/YouTube DBs
// (out of scope for a verse-retrieval eval) are faked.
import { describe, it, vi, beforeAll } from 'vitest'
import { tmpdir } from 'os'
import { EVAL_CASES, type EvalCase } from './retrievalFixtures'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir() },
  net: {},
  ipcMain: { handle: () => {} },
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('better-sqlite3', async () => ({ default: (await import('./betterSqlite3NodeShim')).default }))
// Notes/YouTube are genuinely out of scope for a verse-retrieval eval (no fixture question in
// retrievalFixtures.ts is a notes/video ask) — mocked to empty rather than wired to real data.
vi.mock('../../electron/db/berean', () => ({ getBereanDb: () => { throw new Error('notes DB not used in retrieval eval') } }))
vi.mock('../../electron/ipc/youtube', () => ({ searchYoutubeVideos: () => [], searchYoutubeTranscripts: () => [] }))

// Distinguishes which of the four runOllamaJson call shapes aiLookup.ts is making by a unique
// substring of each prompt (see extractionPrompt/critiquePrompt/verificationPrompt/
// relevancePrunePrompt in aiLookup.ts) — verified directly against those functions' actual
// literal JSON-shape text, not guessed. `currentCase` is set before each runLookup call so the
// extraction branch knows which fixture's fixed keyword list to hand back.
let currentCase: EvalCase | null = null
const runOllamaJsonMock = vi.fn(async (prompt: string) => {
  if (prompt.includes('"guesses"')) {
    // Extraction call — hand back exactly the fixture's pre-written keywords, standing in for
    // whatever a real Ollama extraction call would have produced (see file header).
    return { keywords: currentCase?.keywords ?? [], guesses: [], answerKind: null }
  }
  if (prompt.includes('"answersQuestion"')) {
    // Critique — a harmless no-op verdict (matches Team B's own finding that critique's real
    // calls return an empty-change verdict on a real candidate; see mission brief item 3).
    return { answersQuestion: true, leadKind: 'verses' }
  }
  if (prompt.includes('"satisfied"')) {
    // Agentic verification loop — not exercised (agentic:false below), but degrade safely if
    // ever hit.
    return { satisfied: true }
  }
  if (prompt.includes('"irrelevant"')) {
    // Relevance-prune pass — keep everything (no-op) rather than risk pruning something the
    // eval is trying to measure.
    return { irrelevant: [] }
  }
  return {}
})
vi.mock('../../electron/ollama', () => ({
  checkOllamaAvailable: async () => ({ available: true }),
  runOllamaJson: (...args: unknown[]) => runOllamaJsonMock(args[0] as string),
  runOllamaText: async () => '',
  DEFAULT_OLLAMA_MODEL: 'eval-model',
  unloadOllamaImmediately: () => {},
  NUM_CTX: 16384,
  NUM_PREDICT_JSON: 512,
}))

interface CaseResult {
  id: string
  category: string
  ranks: number[] // 1-based rank of each expected ref found in results, in results order; empty if none found
  totalResults: number
}

function refKey(r: { textId: string; bookId: string; chapter: number; verse: number }): string {
  return `${r.textId}|${r.bookId}|${r.chapter}|${r.verse}`
}

describe('AI Lookup retrieval eval (report-only — see file header)', () => {
  let runLookup: typeof import('../../electron/ipc/aiLookup').runLookup

  beforeAll(async () => {
    ;({ runLookup } = await import('../../electron/ipc/aiLookup'))
  })

  it('reports recall@k and MRR across the fixture set', async () => {
    const caseResults: CaseResult[] = []
    // Strong's ID resolution — the RIGHT metric for category:'strongs' cases (see the METHODOLOGY
    // GAP comment in retrievalFixtures.ts). A word-meaning question is answered by
    // `response.strongsCard`, never by a verse in `response.results` — scoring those cases via
    // the same recall@k as every other category conflates "did the right word get identified"
    // with "did an unrelated verse-ranking pipeline also happen to surface a relevant verse".
    // Tracked separately, alongside (not instead of) the existing recall@k, so this doesn't
    // change what the other 5 categories have always measured.
    const strongsResults: Array<{ id: string; expected: string; got: string | undefined; hit: boolean }> = []

    for (const c of EVAL_CASES) {
      currentCase = c
      const expectedKeys = new Set(c.expected.map(refKey))
      let response
      try {
        response = await runLookup(c.question, { commentary: false, agentic: false }, () => {})
      } catch (err) {
        console.error(`[eval] CRASHED on ${c.id}: ${(err as Error).message}`)
        caseResults.push({ id: c.id, category: c.category, ranks: [], totalResults: 0 })
        continue
      }
      if (process.env.EVAL_DEBUG === c.id || (process.env.EVAL_DEBUG === 'ZERO' && response.results.length === 0)) {
        console.log(`\n[DEBUG ${c.id}] keywords=${JSON.stringify(response.keywords)}`)
        console.log(response.results.map((r) => `${r.source} ${r.textId}/${r.bookId} ${r.chapter}:${r.verse} — ${r.text.slice(0, 60)}`))
      }
      if (c.expectedStrongsId) {
        const got = response.strongsCard?.strongsNum
        strongsResults.push({ id: c.id, expected: c.expectedStrongsId, got, hit: got === c.expectedStrongsId })
      }
      const ranks: number[] = []
      response.results.forEach((r, i) => {
        if (expectedKeys.has(refKey(r))) ranks.push(i + 1)
      })
      caseResults.push({ id: c.id, category: c.category, ranks, totalResults: response.results.length })
    }

    const ks = [1, 3, 5, 10]
    const recallAt = (k: number) =>
      caseResults.filter((c) => c.ranks.some((r) => r <= k)).length / caseResults.length
    const mrr =
      caseResults.reduce((sum, c) => sum + (c.ranks.length > 0 ? 1 / Math.min(...c.ranks) : 0), 0) /
      caseResults.length

    console.log('\n=== AI Lookup retrieval eval ===')
    console.log(`Cases: ${caseResults.length}`)
    for (const k of ks) console.log(`recall@${k}: ${(recallAt(k) * 100).toFixed(1)}%`)
    console.log(`MRR: ${mrr.toFixed(3)}`)

    console.log('\nBy category:')
    const categories = [...new Set(caseResults.map((c) => c.category))]
    for (const cat of categories) {
      const inCat = caseResults.filter((c) => c.category === cat)
      const r1 = inCat.filter((c) => c.ranks.some((r) => r <= 1)).length / inCat.length
      const r10 = inCat.filter((c) => c.ranks.some((r) => r <= 10)).length / inCat.length
      console.log(`  ${cat.padEnd(16)} n=${String(inCat.length).padEnd(3)} recall@1=${(r1 * 100).toFixed(0)}%  recall@10=${(r10 * 100).toFixed(0)}%`)
    }

    if (strongsResults.length > 0) {
      const strongsAccuracy = strongsResults.filter((s) => s.hit).length / strongsResults.length
      console.log(`\nStrong's ID resolution (the real signal for 'strongs' cases — see retrievalFixtures.ts's METHODOLOGY GAP comment):`)
      console.log(`  accuracy: ${(strongsAccuracy * 100).toFixed(0)}% (${strongsResults.filter((s) => s.hit).length}/${strongsResults.length})`)
      for (const s of strongsResults) {
        console.log(`  ${s.hit ? '✓' : '✗'} ${s.id.padEnd(20)} expected=${s.expected.padEnd(7)} got=${s.got ?? '(none)'}`)
      }
    }

    console.log('\nMisses (not found in top 10):')
    for (const c of caseResults) {
      if (!c.ranks.some((r) => r <= 10)) console.log(`  [${c.category}] ${c.id} (${c.totalResults} results returned)`)
    }
    console.log('')
    // No assertion on the numbers themselves — this test's job is to print the report, not to
    // pass/fail a threshold (see file header: the whole point is a repeatable BEFORE/AFTER
    // number, not a gate). It only needs to not crash.
  }, 120_000)
})

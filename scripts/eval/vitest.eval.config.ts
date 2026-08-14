// Separate vitest config just for the retrieval eval harness (runRetrievalEval.ts).
//
// Why a separate config instead of adding this file to the main vitest.config.ts's `include`:
// that file's default include glob (`*.test.*`/`*.spec.*`) is what every OTHER team relies on
// for the "3470 tests across 99 files" baseline count — this harness deliberately isn't named
// `*.test.ts` so a bare `npx vitest run` / `npm test` never sweeps it in (it's a slow-ish
// real-SQLite report generator with no pass/fail assertions, not a regression test). Run it with:
//   npx vitest run --config scripts/eval/vitest.eval.config.ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node', // no DOM needed; plain node also matches where `node:sqlite` is used
    globals: true,
    // semanticEval.ts (Round: embedding retrieval) added alongside — same "report-only, not
    // *.test.ts, never swept into npm test" convention as runRetrievalEval.ts (see that file's own
    // header). It self-skips gracefully when the embedding index hasn't been built yet or Ollama
    // isn't running, so including it here is safe even when those aren't true.
    include: ['scripts/eval/runRetrievalEval.ts', 'scripts/eval/semanticEval.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
  },
})

// Separate config for the AI benchmark (report-only; never swept into `npm test`).
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: { environment: 'node', globals: true, include: ['scripts/eval/bench/runBench.ts'], testTimeout: 6 * 60 * 60 * 1000 },
  resolve: { alias: { '@': resolve(__dirname, '../../../src') } },
})

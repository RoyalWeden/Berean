import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  // Same reason as electron.vite.config.ts's renderer cacheDir: node_modules is symlinked across
  // worktrees, so anything Vite caches under it is shared between checkouts. Keeping the test
  // cache per-checkout too means a test run here can never disturb a dev server running in
  // another worktree (or in main).
  cacheDir: resolve(__dirname, '.vite-test'),
  test: {
    environment: 'jsdom',
    globals: true,
    // Default (false) stubs out `.css` imports with empty exports, which
    // silently breaks `?raw` CSS imports too (e.g. NoteEditor.tsx's
    // `pmEditor.css?raw`, used to inline the live editor's stylesheet into
    // print/PDF export) — they'd resolve to an empty string in tests only,
    // never in the real Vite app build.
    css: true,
    // Never descend into git worktrees kept under `.claude/` (agent scratch
    // checkouts, temporary feature worktrees). They carry their own stale copy
    // of the test suite at whatever commit they were cut from, which otherwise
    // shows up as spurious failures in a full `vitest run`.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})

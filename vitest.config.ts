import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Default (false) stubs out `.css` imports with empty exports, which
    // silently breaks `?raw` CSS imports too (e.g. NoteEditor.tsx's
    // `pmEditor.css?raw`, used to inline the live editor's stylesheet into
    // print/PDF export) — they'd resolve to an empty string in tests only,
    // never in the real Vite app build.
    css: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})

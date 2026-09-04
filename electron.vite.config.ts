import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { buildCSP } from './electron/csp'

// Function form (not a plain object) so the renderer's CSP-injecting plugin below can read
// Vite's own `command` ('serve' for `electron-vite dev`, 'build' for every packaged/production
// build) — the exact same dev/prod signal `is.dev` gives main.ts's own CSP handler. See
// electron/csp.ts's header for why this file needs to know that at all.
export default defineConfig(({ command }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        }
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    // Vite's dependency-optimizer cache lives in `<cacheDir>/deps`, and its default is
    // `node_modules/.vite`. In this project `node_modules` is a SYMLINK into the main working
    // tree (see CLAUDE.md's worktree setup / scripts/setup-worktree.sh), so every worktree and
    // main were sharing ONE deps cache. Whichever process optimized last rewrote the chunk
    // filenames out from under any already-running dev server, whose page then requested chunks
    // that no longer existed:
    //     GET .../node_modules/.vite/deps/chunk-N3NPDJLS.js?v=9e965314  404 (Not Found)
    // — with a CURRENT browserHash, so nothing invalidated and the page stayed broken until the
    // cache was cleared by hand. Pointing the cache at a per-checkout directory (which is NOT
    // behind the symlink) gives each worktree its own, so they can't collide at all.
    cacheDir: resolve(__dirname, '.vite'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html')
        }
      }
    },
    plugins: [
      react(),
      {
        // Injects the <meta http-equiv="Content-Security-Policy"> tag src/index.html
        // deliberately doesn't hardcode — see that file's comment and csp.ts's header for why a
        // hand-written tag here previously drifted out of sync with main.ts's CSP handler
        // (which, unlike this tag, has no effect at all on a packaged/file:// build).
        name: 'inject-csp-meta',
        transformIndexHtml() {
          return [{
            tag: 'meta',
            injectTo: 'head-prepend',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: buildCSP(command === 'serve'),
            },
          }]
        }
      }
    ],
    css: {
      postcss: resolve(__dirname, 'postcss.config.js')
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    }
  }
}))

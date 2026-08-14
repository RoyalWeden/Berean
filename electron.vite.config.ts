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

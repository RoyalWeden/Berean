import { resolve } from 'path'
import { existsSync, renameSync, readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildIosCSP } from './src/platform/ios/csp'

/**
 * Vite config for the iPhone (Capacitor) build of the renderer. The desktop build is untouched —
 * it still goes through electron.vite.config.ts. This config shares the same root, alias, PostCSS
 * (Tailwind) and React plugin, and differs only in:
 *   - output dir `out/ios` (Capacitor's `webDir`, see capacitor.config.ts);
 *   - `VITE_PLATFORM=ios` exposed to the renderer so src/main.tsx picks the mobile shell and the
 *     in-process window.* bridge (src/platform/ios) instead of expecting Electron's preload;
 *   - a WKWebView-appropriate CSP <meta> (src/platform/ios/csp.ts) instead of electron/csp.ts's.
 *
 *   npm run ios:sync   → vite build -c vite.ios.config.ts && cap sync ios
 *   npm run ios:dev    → vite -c vite.ios.config.ts (live reload on device via cap run --livereload)
 */
export default defineConfig(({ command }) => ({
  root: resolve(__dirname, 'src'),
  base: './',
  cacheDir: resolve(__dirname, '.vite-ios'),
  define: {
    'import.meta.env.VITE_PLATFORM': JSON.stringify('ios'),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify((JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version),
  },
  build: {
    outDir: resolve(__dirname, 'out/ios'),
    emptyOutDir: true,
    target: ['safari17'],
    sourcemap: command === 'serve',
    rollupOptions: {
      // The iOS entry is its own HTML so src/main.tsx (the desktop entry) stays untouched.
      input: { index: resolve(__dirname, 'src/index.ios.html') },
    },
  },
  plugins: [
    react(),
    {
      // Capacitor's webDir must contain `index.html`; Vite emits the entry under its source
      // name (index.ios.html), so rename it on disk once the bundle is written.
      name: 'rename-ios-entry',
      closeBundle() {
        const outDir = resolve(__dirname, 'out/ios')
        const from = resolve(outDir, 'index.ios.html')
        if (existsSync(from)) renameSync(from, resolve(outDir, 'index.html'))
      },
    },
    {
      name: 'inject-csp-meta',
      transformIndexHtml() {
        return [{
          tag: 'meta',
          injectTo: 'head-prepend',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildIosCSP(command === 'serve') },
        }]
      },
    },
  ],
  css: { postcss: resolve(__dirname, 'postcss.config.js') },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: { host: true, port: 5183 },
}))

import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import FloatingShell from '@/components/shell/FloatingShell'
import ViewerApp from '@/components/viewer/ViewerApp'
import StudyTrailApp from '@/components/studyTrail/StudyTrailApp'
import VersePickerApp from '@/components/studyTrail/VersePickerApp'
import { initScrollbarAutoHide } from '@/lib/scrollbarAutoHide'
import './styles/global.css'
import 'pdfjs-dist/web/pdf_viewer.css'

initScrollbarAutoHide()

// ── Persistent debug flags ──────────────────────────────────────────────────
// Backs window.__bereanPresenterDebug / window.__bereanTrailDebug with localStorage (shared
// across all windows — same origin) instead of a plain in-memory property. Previously, setting
// `window.__bereanPresenterDebug = true` in devtools only lasted until the next reload/restart,
// which is exactly what a real repro often needs (restarting the app to pick up code changes,
// or the presenter window itself reloading) — silently losing the flag and producing "nothing
// logged" reports that looked like the logging was never added at all. Now set once, in any
// window, and it stays on (including surviving a full app restart) until explicitly turned off.
// Applies to EVERY renderer (main window, presenter/viewer window, Study Trail window) since
// this file is main.tsx, shared by all of them.
function definePersistentDebugFlag(prop: '__bereanPresenterDebug' | '__bereanTrailDebug', storageKey: string) {
  Object.defineProperty(window, prop, {
    configurable: true,
    get() {
      try { return localStorage.getItem(storageKey) === '1' } catch { return false }
    },
    set(v: boolean) {
      try {
        if (v) { localStorage.setItem(storageKey, '1'); console.log(`[Debug] ${prop} = true (persisted — stays on until set to false, including across restarts)`) }
        else { localStorage.removeItem(storageKey); console.log(`[Debug] ${prop} = false`) }
      } catch { /* ignore — storage unavailable, flag just won't persist this run */ }
    },
  })
}
definePersistentDebugFlag('__bereanPresenterDebug', 'berean-debug-presenter')
definePersistentDebugFlag('__bereanTrailDebug', 'berean-debug-trail')
if (window.__bereanPresenterDebug) console.log('[Debug] __bereanPresenterDebug is ON (persisted from a previous session)')
if (window.__bereanTrailDebug) console.log('[Debug] __bereanTrailDebug is ON (persisted from a previous session)')

// Very first line of renderer JS — confirms the bundle is executing.

const searchParams = new URLSearchParams(window.location.search)
const isFloatMode = searchParams.get('float') === '1'
const isViewerMode = searchParams.get('viewer') === '1'
const isStudyTrailMode = searchParams.get('studyTrail') === '1'
const isVersePickerMode = searchParams.get('versePicker') === '1'

// Design-system window stamps (read by global.css). `data-window` names which renderer root
// this is; `data-vibrant` is present ONLY where the BrowserWindow is genuinely transparent with
// native vibrancy behind it — the main window on macOS (electron/main.ts) — so `.material-bar`
// can be translucent there and fall back to an opaque paint everywhere else (Windows, and every
// secondary window: pop-out tab, presenter/viewer, Study Trail, verse picker are all opaque).
{
  const html = document.documentElement
  html.dataset.window = isViewerMode ? 'viewer' : isStudyTrailMode ? 'trail' : isVersePickerMode ? 'picker' : isFloatMode ? 'float' : 'main'
  if (html.dataset.window === 'main' && window.__berean_platform === 'darwin') html.dataset.vibrant = ''
  else delete html.dataset.vibrant
}

// Inactive-window stamp (§85) — electron/main.ts forwards this window's own focus/blur as
// app:windowActive; global.css's html[data-inactive] dims chrome to match every other native
// Mac app once it isn't key. Initialised from document.hasFocus() so a window that opens
// already out of focus (e.g. a secondary window spawned behind the main one) starts dim too,
// rather than waiting for its first blur event.
{
  const html = document.documentElement
  if (!document.hasFocus()) html.dataset.inactive = ''
  else delete html.dataset.inactive
  window.app?.onWindowActive?.((active) => {
    if (active) delete html.dataset.inactive
    else html.dataset.inactive = ''
  })
}

// Reduce Transparency (System Settings → Accessibility → Display) — global.css's
// html[data-reduce-transparency] already swaps every material to its opaque twin.
// getReduceTransparency() gives the true value at boot; onReduceTransparency covers a live
// toggle while the app is running.
{
  const html = document.documentElement
  window.app?.getReduceTransparency?.().then((reduce) => {
    if (reduce) html.dataset.reduceTransparency = ''
    else delete html.dataset.reduceTransparency
  }).catch(() => { /* best-effort — falls back to no attribute (full transparency) */ })
  window.app?.onReduceTransparency?.((reduce) => {
    if (reduce) html.dataset.reduceTransparency = ''
    else delete html.dataset.reduceTransparency
  })
}

// Dev-only: expose the store for visual-QA tooling driven over CDP (BEREAN_CDP_PORT).
if (import.meta.env.DEV) {
  import('@/store').then((m) => { (window as unknown as { __bereanStore?: unknown }).__bereanStore = m.useAppStore }).catch(() => {})
}

// ── Global crash handler ──────────────────────────────────────────────────────
// Uses raw DOM (not React) so it works even if the React tree is dead.

let overlayShown = false

function showCrashOverlay(message: string, stack: string, source: string) {
  if (overlayShown) return
  overlayShown = true

  // Save for the CrashReport component to display after restart
  try {
    localStorage.setItem('berean-crash', JSON.stringify({
      message, stack, label: source, timestamp: Date.now(),
    }))
  } catch { /* ignore */ }

  const overlay = document.createElement('div')
  overlay.id = 'crash-overlay'
  overlay.style.cssText = [
    // pointer-events:auto — a Radix modal (Settings, Import…) sets `pointer-events:none` on
    // <body> while open, which this overlay would otherwise inherit and become unclickable.
    'position:fixed', 'inset:0', 'z-index:99999', 'pointer-events:auto',
    'background:rgba(10,10,12,0.92)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:system-ui,sans-serif',
  ].join(';')

  overlay.innerHTML = `
    <div style="
      background:#1c1c22; border:1px solid rgba(255,255,255,0.1);
      border-radius:12px; padding:24px; max-width:480px; width:90%;
      box-shadow:0 20px 60px rgba(0,0,0,0.6);
    ">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span style="font-size:18px;">⚠️</span>
        <p style="color:#f87171;font-weight:600;font-size:14px;margin:0;">
          The app encountered an error
        </p>
      </div>
      <p style="color:#a0a0b0;font-size:12px;margin:0 0 6px;">
        ${escapeHtml(source)}
      </p>
      <pre style="
        color:#6b7280; font-size:11px; background:#111116;
        border-radius:6px; padding:10px; overflow:auto;
        max-height:140px; white-space:pre-wrap; word-break:break-all;
        margin:0 0 16px;
      ">${escapeHtml(message)}</pre>
      <div style="display:flex;gap:8px;">
        <button id="crash-restart" style="
          background:#3b82f6; color:white; border:none;
          border-radius:6px; padding:7px 16px; font-size:12px;
          font-weight:600; cursor:pointer;
        ">Restart app</button>
        <button id="crash-copy" style="
          background:#2a2a32; color:#a0a0b0; border:1px solid rgba(255,255,255,0.1);
          border-radius:6px; padding:7px 16px; font-size:12px; cursor:pointer;
        ">Copy details</button>
        <button id="crash-dismiss" style="
          background:transparent; color:#6b7280; border:none;
          border-radius:6px; padding:7px 12px; font-size:12px; cursor:pointer;
        ">Dismiss</button>
      </div>
    </div>
  `

  document.body.appendChild(overlay)

  document.getElementById('crash-restart')?.addEventListener('click', () => {
    window.location.reload()
  })
  document.getElementById('crash-copy')?.addEventListener('click', () => {
    const text = `Error: ${message}\nSource: ${source}\n\nStack:\n${stack}`
    navigator.clipboard.writeText(text).catch(() => {})
    const btn = document.getElementById('crash-copy')
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy details' }, 2000) }
  })
  document.getElementById('crash-dismiss')?.addEventListener('click', () => {
    overlay.remove()
    overlayShown = false
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Chromium fires a global "error" event (no real Error object, e.filename === the
// app's own index.html) for the benign ResizeObserver notification-loop warning:
// a ResizeObserver callback resized something and the browser couldn't deliver
// every notification within the same frame. It's spec-compliant, self-correcting
// on the next frame, and nothing is broken — but it's essentially guaranteed to
// fire now and then given how many ResizeObservers the app runs (react-mosaic
// panels, the presenter band, the notes editor, Study Trail overlays…). Without
// this guard it popped the full-screen crash overlay for a non-issue.
const RESIZE_OBSERVER_LOOP_RE = /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)/

window.addEventListener('error', (e) => {
  if (RESIZE_OBSERVER_LOOP_RE.test(e.message)) return
  const stack = e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`
  // Ignore errors from browser extensions or devtools
  if (!e.filename || e.filename.startsWith('chrome-extension://')) return
  showCrashOverlay(e.message, stack, 'Unhandled JS error')
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? (reason.stack ?? '') : ''
  // Skip noisy / non-fatal IPC rejections (they're logged elsewhere)
  if (!message || message === 'undefined') return
  showCrashOverlay(message, stack, 'Unhandled promise rejection')
})
// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* reducedMotion="user": every framer-motion animation in every window honors the OS
        "Reduce motion" setting (CSS transitions are covered by global.css's media rule). */}
    <MotionConfig reducedMotion="user">
      {isViewerMode ? <ViewerApp /> : isStudyTrailMode ? <StudyTrailApp /> : isVersePickerMode ? <VersePickerApp /> : isFloatMode ? <FloatingShell /> : <App />}
    </MotionConfig>
  </React.StrictMode>
)

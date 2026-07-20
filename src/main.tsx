import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import FloatingShell from '@/components/shell/FloatingShell'
import ViewerApp from '@/components/viewer/ViewerApp'
import { initScrollbarAutoHide } from '@/lib/scrollbarAutoHide'
import './styles/global.css'
import 'pdfjs-dist/web/pdf_viewer.css'

initScrollbarAutoHide()

// Very first line of renderer JS — confirms the bundle is executing.

const searchParams = new URLSearchParams(window.location.search)
const isFloatMode = searchParams.get('float') === '1'
const isViewerMode = searchParams.get('viewer') === '1'

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
    'position:fixed', 'inset:0', 'z-index:99999',
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

window.addEventListener('error', (e) => {
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
    {isViewerMode ? <ViewerApp /> : isFloatMode ? <FloatingShell /> : <App />}
  </React.StrictMode>
)

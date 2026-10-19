/**
 * Startup / interaction timing marks (performance audit 2026-10-19,
 * docs/performance-audit-2026-10-19.md). Each name is recorded ONCE, as milliseconds since this
 * renderer's navigation start (`performance.now()`), in `window.__bereanPerf` — read by the
 * CDP / probe benchmark scripts. Recording is a map write: no logging, no content, and safe to
 * leave in production (nothing reads it there).
 */
export type PerfMarkName =
  | 'modules-evaluated' // every statically imported module has run (main.tsx's body starts)
  | 'react-render'      // ReactDOM.render was called
  | 'app-mounted'       // the root app's first commit (layout effect)
  | 'scripture-visible' // the first Scripture chapter's verses are in the DOM
  | 'interactive'       // the first idle period after first useful content

type PerfWindow = { __bereanPerf?: Record<string, number> }

export function perfMark(name: PerfMarkName | (string & {})): void {
  const w = window as unknown as PerfWindow
  const marks = (w.__bereanPerf ??= {})
  if (name in marks) return
  marks[name] = Math.round(performance.now() * 10) / 10
}

/** Marks 'interactive' at the first idle period (or after a frame where idle callbacks are
 *  missing — WKWebView). */
export function markInteractiveWhenIdle(): void {
  const done = () => perfMark('interactive')
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(done, { timeout: 2000 })
  else requestAnimationFrame(() => setTimeout(done, 0))
}

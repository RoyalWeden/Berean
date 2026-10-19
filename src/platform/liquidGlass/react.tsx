import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { liquidGlassAdapter, liquidGlassCapabilities, liquidGlassCapabilitiesSettled, loadLiquidGlassCapabilities, subscribeLiquidGlass } from './capabilities'
import { liquidGlassTokens, roleRadius } from './tokens'
import type { LiquidGlassCapabilities, LiquidGlassOptions, LiquidGlassRect } from './types'

/**
 * React bindings for the semantic glass API. A component keeps its normal DOM; when a native
 * adapter is present the hook places the native surface exactly under the element (macOS: behind
 * the page — the element must then not paint its own background; see `native` in the result).
 */

export function useLiquidGlassCapabilities(): LiquidGlassCapabilities {
  useEffect(() => { void loadLiquidGlassCapabilities() }, [])
  return useSyncExternalStore(subscribeLiquidGlass, liquidGlassCapabilities, liquidGlassCapabilities)
}

interface GroupCtx { id: string; version: number }
const GroupContext = createContext<GroupCtx | null>(null)

const sameRect = (a: LiquidGlassRect | null, b: LiquidGlassRect) =>
  !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

function rectOf(el: Element): LiquidGlassRect {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

/** Calls `sync` whenever the element's box may have changed (its size, the window, layout). */
function useLayoutTracking(ref: RefObject<Element | null>, active: boolean, sync: () => void) {
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    let raf = 0
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync() }) }
    sync()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(el)
    ro?.observe(document.documentElement)
    window.addEventListener('resize', schedule)
    // Moves without a size change (a neighbour resizing) — cheap: one rect read per frame at most.
    document.addEventListener('transitionend', schedule, true)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('transitionend', schedule, true)
    }
  }, [ref, active, sync])
}

export interface UseLiquidGlassSurfaceResult {
  /** A native surface is drawing this element's material — drop the CSS background. */
  native: boolean
}

/**
 * Keep one native glass surface under `ref`. Returns `{ native }`: false means the CSS material
 * stays (no adapter, reduced transparency fallback handled natively, or the bridge failed).
 */
export function useLiquidGlassSurface(ref: RefObject<HTMLElement | null>, opts: LiquidGlassOptions & { enabled?: boolean }): UseLiquidGlassSurfaceResult {
  const caps = useLiquidGlassCapabilities()
  const group = useContext(GroupContext)
  const id = `s${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const enabled = opts.enabled !== false
  const native = enabled && caps.native
  const last = useRef<LiquidGlassRect | null>(null)
  const optsKey = JSON.stringify({ ...opts, enabled: undefined })
  const optsRef = useRef(opts)
  optsRef.current = opts

  const sync = useRef(() => {})
  sync.current = () => {
    const a = liquidGlassAdapter()
    const el = ref.current
    if (!a || !el) return
    const rect = rectOf(el)
    const o = optsRef.current
    const t = liquidGlassTokens(caps.platform)
    const visible = rect.width > 0 && rect.height > 0 && el.isConnected
    last.current = rect
    void a.surface({
      id,
      rect,
      variant: o.variant ?? 'regular',
      role: o.role ?? 'custom',
      interactive: !!o.interactive && caps.interactive,
      tint: o.tint ?? null,
      cornerRadius: o.cornerRadius ?? roleRadius(o.role, t, rect.height),
      group: group?.id ?? o.group ?? null,
      pin: o.pin,
      visible,
    })
  }
  const stableSync = useRef(() => {
    const el = ref.current
    if (el && sameRect(last.current, rectOf(el))) return
    sync.current()
  }).current

  // Options or group changes: push immediately (rect unchanged).
  useEffect(() => { if (native) sync.current() }, [native, optsKey, group?.version]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutTracking(ref, native, stableSync)
  useEffect(() => {
    if (!native) return
    return () => { last.current = null; void liquidGlassAdapter()?.destroy(id, 'surface') }
  }, [native, id])

  return { native }
}

/**
 * A native glass group: member surfaces rendered inside it blend and merge as one element when
 * they come within `spacing` (NSGlassEffectContainerView / UIGlassContainerEffect). Without a
 * native adapter it is a plain wrapper.
 */
export function LiquidGlassGroup({ children, spacing, className, style, pin }: { children: ReactNode; spacing?: number; className?: string; style?: React.CSSProperties; pin?: LiquidGlassOptions['pin'] }) {
  const caps = useLiquidGlassCapabilities()
  const ref = useRef<HTMLDivElement>(null)
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [version, setVersion] = useState(0)
  const native = caps.native && caps.grouping
  const t = liquidGlassTokens(caps.platform)
  const last = useRef<LiquidGlassRect | null>(null)
  const sync = useRef(() => {
    const a = liquidGlassAdapter()
    const el = ref.current
    if (!a || !el) return
    const rect = rectOf(el)
    if (sameRect(last.current, rect)) return
    last.current = rect
    void a.group({ id, rect, spacing: spacing ?? t.groupSpacing, pin, visible: rect.width > 0 && rect.height > 0 }).then(() => setVersion((v) => v + 1))
  }).current
  useLayoutTracking(ref, native, sync)
  useEffect(() => {
    if (!native) return
    return () => { last.current = null; void liquidGlassAdapter()?.destroy(id, 'group') }
  }, [native, id])
  return (
    <GroupContext.Provider value={native ? { id, version } : null}>
      <div ref={ref} className={className} style={style}>{children}</div>
    </GroupContext.Provider>
  )
}

/** Berean's resolved theme (html.dark) — native controls follow the app, not just the OS. */
function themeAppearance(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}
/** The theme accent (--color-accent: "r g b") as #rrggbb, for prominent native controls. */
function themeAccent(): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim().split(/[\s,]+/).map(Number)
  if (v.length < 3 || v.some((n) => Number.isNaN(n))) return null
  return '#' + v.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
}

export interface LiquidGlassControlDef {
  id: string
  /** The web placeholder this native control stands in for (layout, occlusion, fallback). */
  ref: RefObject<HTMLElement | null>
  symbol: string
  label: string
  badge?: string
  title?: string
  subtitle?: string
  prominent?: boolean
  iconSize?: number
  onPress: () => void
}

/**
 * A cluster of related controls drawn by the platform's own glass (iOS: UIGlassEffect buttons in a
 * UIGlassContainerEffect, above the web view). The web buttons stay in the DOM as invisible
 * placeholders: they own layout (safe areas, CSS), are the fallback when no native adapter exists,
 * and drive occlusion — a native control is drawn only while its placeholder is the topmost
 * element at its centre, so any sheet, popover or scrim that covers it hides the native control
 * too (native views always sit above the page; this keeps web overlays visually on top).
 *
 * Returns `{ native }`: when true the caller hides the placeholders (opacity 0, aria-hidden) and
 * VoiceOver focuses the native controls.
 */
/** Native fade-in (BereanGlassPlugin.swift: GlassItem 0.16s, a new GlassCluster 0.24s) — a
 *  placeholder hides only after it, so the hand-off never shows an empty spot. */
const NATIVE_FADE_MS = 260
let firstPaint: Promise<void> | null = null
/** Resolves once the web view has actually painted the app (two frames after load + a beat). */
export function afterFirstPaint(): Promise<void> {
  if (!firstPaint) {
    firstPaint = new Promise((resolve) => {
      const go = () => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 60)))
      if (document.readyState === 'complete') go()
      else window.addEventListener('load', go, { once: true })
    })
  }
  return firstPaint
}

/** The class callers put on a placeholder while `isNative(id)` (mobile.css: invisible). The hook
 *  removes it itself the moment a placeholder becomes covered — see G-08 in sync. */
export const NATIVE_GLASS_CLASS = 'is-native-glass'

/**
 * The element that really covers a point, looking THROUGH invisible tap-catcher layers marked
 * `data-glass-passthrough` (a popover menu's full-screen outside-tap layer, the tab switcher's
 * light scrim). TEST 2026-10-17 "whenever i click a button, it turns off the glass/liquid of other
 * things": opening any popover put its transparent layer over the whole screen, every native
 * control counted as covered, and the bar and the title fell back to their flatter web twins until
 * the menu closed. A real cover (a sheet, its dimming backdrop, the menu itself) still counts.
 */
function topHit(x: number, y: number): Element | null {
  const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)]
  for (const e of stack) if (e && !e.closest('[data-glass-passthrough]')) return e
  return null
}

/** Whether `el` (or an ancestor) is moving / fading in a running CSS transition right now. */
function inCssTransition(el: Element): boolean {
  if (typeof document.getAnimations !== 'function' || typeof CSSTransition === 'undefined') return false
  try {
    return document.getAnimations().some((a) => {
      if (!(a instanceof CSSTransition) || a.playState !== 'running') return false
      const t = (a.effect as KeyframeEffect | null)?.target
      return !!t && t.contains(el)
    })
  } catch { return false }
}

/**
 * One live owner per native cluster id (TEST 2026-10-17 "sometimes that label of the book and
 * chapter goes away"). Pages remount on every tab switch (NavigationStack key) and each reader
 * instance uses the same `reader-title` cluster. The old instance's late timers (the post-fade
 * re-sync, the cover hand-off frames) used to run AFTER it unmounted: its refs were null, so it
 * sent an all-hidden spec for the shared cluster, the new instance never re-sent (its own spec had
 * not changed) and the title stayed hidden — its placeholder transparent — until an option changed.
 * Now only the current owner may send or remove a cluster, and an unmounted instance does nothing.
 */
const clusterOwners = new Map<string, symbol>()

export function useLiquidGlassControls(
  clusterId: string,
  items: LiquidGlassControlDef[],
  opts: { role: LiquidGlassOptions['role']; visible?: boolean; collapsed?: boolean; collapseEdge?: 'top' | 'bottom'; spacing?: number; appearance?: 'light' | 'dark' | null; accent?: string | null; onSwipe?: (dir: 'next' | 'previous') => void },
): { native: boolean; isNative: (id: string) => boolean } {
  const caps = useLiquidGlassCapabilities()
  const adapter = caps.native ? liquidGlassAdapter() : null
  const native = !!adapter?.controls
  // FIRST appearance (perf/glass QA G-03, docs/mobile/performance-glass-qa.md): while the platform
  // is going to draw these controls natively — its adapter is installed and capabilities are still
  // loading, or say native — the web placeholders stay invisible until the first native draw. On
  // every cold launch they used to show for ~330 ms and then be replaced by the native controls,
  // with different glyphs and material: a visible swap. Ends (placeholders shown as normal) on
  // the first confirmed native draw, when capabilities settle as non-native, or if the native call
  // fails — so a control can never be left missing. Later hand-offs (a sheet covering the bar)
  // keep the confirmed-on-screen rule below.
  const nativePending = !caps.native && !liquidGlassCapabilitiesSettled() && !!liquidGlassAdapter()?.controls
  const [firstDrawDone, setFirstDrawDone] = useState(false)
  const awaitingFirstDraw = !firstDrawDone && (native || nativePending)
  // Which items the platform is drawing right now (not covered / off screen). A placeholder is
  // made invisible ONLY while its native twin is shown — otherwise the web control is the one seen.
  const [shownKey, setShownKey] = useState('')
  const itemsRef = useRef(items); itemsRef.current = items
  const optsRef = useRef(opts); optsRef.current = opts
  const lastRects = useRef<Record<string, LiquidGlassRect>>({})
  const lastSent = useRef('')
  // When each item's native twin was confirmed on screen (bridge call resolved).
  const drawnAt = useRef(new Map<string, number>())
  // A covered control's native hide waiting for the web placeholder's frame (G-08).
  const pendingCoverRef = useRef(false)
  const owner = useRef<symbol>(Symbol(clusterId))
  const mounted = useRef(false)
  const timers = useRef(new Set<number>())
  const later = (fn: () => void, ms: number) => { const t = window.setTimeout(() => { timers.current.delete(t); fn() }, ms); timers.current.add(t) }
  useEffect(() => {
    mounted.current = true
    const me = owner.current
    clusterOwners.set(clusterId, me)
    return () => {
      mounted.current = false
      for (const t of timers.current) window.clearTimeout(t)
      timers.current.clear()
      if (clusterOwners.get(clusterId) === me) clusterOwners.delete(clusterId)
    }
  }, [clusterId])

  const sync = useRef(() => {})
  sync.current = () => {
    const a = liquidGlassAdapter()
    if (!a?.controls) return
    // A stale (unmounted or superseded) instance must never touch the shared native cluster.
    if (!mounted.current || clusterOwners.get(clusterId) !== owner.current) return
    const o = optsRef.current
    const collapsed = !!o.collapsed
    const vw = window.innerWidth, vh = window.innerHeight
    // Who OWNS each control's appearance (perf/glass QA G-04/G-05): only a placeholder that is
    // genuinely COVERED by another element (a sheet, popover, scrim) hands the control back to the
    // web, so the web control shows under that overlay. Everything else — collapsed, the cluster
    // hidden on purpose (visible: false), off screen, or still sliding / fading in a CSS transition
    // — stays native: the native control hides, slides or fades itself and the placeholder stays
    // invisible. Dropping native ownership in those cases (as this used to) re-ran the web → native
    // hand-off every time the reader's chrome came back: the web control showed, then the native one
    // faded in over it — a ~200 ms doubled title / swapped icons after every scroll.
    const settledCluster = !collapsed && o.visible !== false
    const occludedIds = new Set<string>()
    const specItems = itemsRef.current.map((it) => {
      const el = it.ref.current
      let rect = lastRects.current[it.id]
      let hidden = !el
      if (el) {
        const r = el.getBoundingClientRect()
        const onScreen = r.width > 0 && r.height > 0 && r.bottom <= vh + 1 && r.top >= -1 && r.left >= -1 && r.right <= vw + 1
        // In flight: moving with a CSS transition (the header / bar sliding back, a fade). Its rect
        // is not where it will rest, so the native control keeps the resting rect meanwhile.
        const moving = inCssTransition(el)
        if (onScreen && settledCluster && !moving) rect = lastRects.current[it.id] = { x: r.left, y: r.top, width: r.width, height: r.height }
        if (settledCluster && !moving) {
          if (!onScreen) hidden = true
          else {
            // Covered if ANY of top / centre / bottom (inset 3 px) is under another element: a
            // sheet rising from below covers the bottom edge first, and testing only the centre let
            // the native control stay drawn over the sheet's leading edge (G-07).
            const cx = r.left + r.width / 2
            const covered = [r.top + 3, r.top + r.height / 2, r.bottom - 3].some((y) => {
              const hit = topHit(cx, y)
              return !hit || !(hit === el || el.contains(hit))
            })
            if (covered) {
              hidden = true; occludedIds.add(it.id)
              // Reveal the web control NOW, in this frame, before the native one is told to hide
              // (it hides instantly): waiting for React's re-render left one frame with neither
              // drawn (G-08). React's own state update follows and agrees.
              el.classList.remove(NATIVE_GLASS_CLASS)
            }
          }
        }
      }
      // A labelled capsule takes its label metrics from the placeholder (same font size and side
      // padding), so the native label fits exactly where the web one did.
      let fontSize: number | undefined, paddingX: number | undefined
      if (it.title && el) { const cs = getComputedStyle(el); fontSize = parseFloat(cs.fontSize) || undefined; paddingX = parseFloat(cs.paddingLeft) || undefined }
      return { id: it.id, symbol: it.symbol, label: it.label, badge: it.badge, title: it.title, subtitle: it.subtitle, fontSize, paddingX, prominent: it.prominent, iconSize: it.iconSize, rect: rect ?? { x: 0, y: 0, width: 0, height: 0 }, hidden: hidden || !rect }
    })
    const visible = o.visible !== false && specItems.some((i) => !i.hidden || collapsed)
    const spec = { id: clusterId, role: o.role ?? 'navigation', items: specItems, spacing: o.spacing ?? liquidGlassTokens('ios').groupSpacing, visible, collapsed, collapseEdge: o.collapseEdge ?? 'bottom', appearance: o.appearance !== undefined ? o.appearance : themeAppearance(), accent: o.accent !== undefined ? o.accent : themeAccent() }
    // While collapsed the native cluster slides away by itself and the placeholders are off screen
    // anyway, so they stay "native" (no web flash during the slide).
    const shownIds = specItems.filter((i) => visible && (collapsed || !i.hidden)).map((i) => i.id)
    // Hand-off between a web placeholder and its native twin (TEST 2026-10-05: "a button
    // sometimes disappears"). A placeholder may turn invisible only once the native control is
    // really ON SCREEN — the bridge call resolved AND its fade-in finished — never on the frame
    // React decides native will draw it (the native view was still being created, or fading in
    // from alpha 0, so for a moment NEITHER was visible). Going the other way (covered → the web
    // control) is immediate: the native one fades out on top of a visible placeholder.
    const drawn = drawnAt.current
    const liveIds = new Set(specItems.map((i) => i.id))
    // A control the native layer is drawing has just become covered.
    const newlyCovered = [...occludedIds].some((id) => drawn.has(id))
    // Ownership returns to the web ONLY when covered (or the item went away).
    for (const id of [...drawn.keys()]) if (occludedIds.has(id) || !liveIds.has(id)) drawn.delete(id)
    const publish = () => {
      const now = performance.now()
      const ready = specItems.map((i) => i.id).filter((id) => { const t = drawn.get(id); return t !== undefined && now - t >= NATIVE_FADE_MS - 5 }).sort().join(',')
      setShownKey((k) => (k === ready ? k : ready))
      // The first native draw has happened — or every control starts out covered (web shows).
      if (ready || (specItems.length > 0 && specItems.every((i) => occludedIds.has(i.id)))) setFirstDrawDone(true)
    }
    publish() // anything no longer drawn natively shows its web placeholder at once
    // Order the hand-off when a control becomes covered (G-08): the web placeholder is revealed now
    // (above, synchronously); the native control is told to hide only once WebKit has produced a
    // frame with the placeholder showing — two animation frames — so the two renderers (separate
    // processes, separate commits) never leave a frame with neither drawn. The native hide itself
    // is then instant (BereanGlassPlugin.GlassItem.setHidden).
    if (newlyCovered && !pendingCoverRef.current) {
      pendingCoverRef.current = true
      requestAnimationFrame(() => requestAnimationFrame(() => { pendingCoverRef.current = false; if (mounted.current) sync.current() }))
      return
    }
    if (pendingCoverRef.current) return
    const key = JSON.stringify(spec)
    const waiting = shownIds.filter((id) => !drawn.has(id))
    if (key === lastSent.current && waiting.length === 0) return
    const sent = key === lastSent.current ? Promise.resolve(true) : a.controls(spec)
    lastSent.current = key
    if (waiting.length) {
      void Promise.resolve(sent).then((ok) => {
        if (ok === false) { setFirstDrawDone(true); return } // native refused: the web controls stay
        if (lastSent.current !== key) return
        const t = performance.now()
        for (const id of waiting) if (!drawn.has(id)) drawn.set(id, t)
        later(() => sync.current(), NATIVE_FADE_MS)
      }, () => setFirstDrawDone(true)) // native call failed: the web controls stay
    }
  }

  // Re-sync on anything that can move or cover the placeholders.
  useEffect(() => {
    if (!native) return
    let raf = 0, ready = false
    const schedule = () => { if (ready && !raf) raf = requestAnimationFrame(() => { raf = 0; sync.current() }) }
    // Nothing native is drawn before the PAGE has painted (TEST 2026-10-05, cold launch): glass
    // shown over the still-blank web view sampled a black backdrop, rendered dark, then visibly
    // re-tinted grey → light as Scripture appeared — the "plain, then glassy" snap.
    let alive = true
    void afterFirstPaint().then(() => { if (alive) { ready = true; schedule() } })
    const ro = new ResizeObserver(schedule)
    for (const it of itemsRef.current) if (it.ref.current) ro.observe(it.ref.current)
    ro.observe(document.documentElement)
    const mo = new MutationObserver(schedule)
    // `style` / `class` too (perf/glass QA G-07): sheets and popovers animate by writing inline
    // transforms frame by frame — no DOM insertion, no transitionend — so a sheet rising over the
    // bottom bar was only noticed by the 350 ms safety interval, and the native glass stayed drawn
    // ON TOP of the sheet for several frames. Ordinary scrolling writes no styles (measured: 0
    // mutations), so this only costs while something actually moves; syncs stay one per frame.
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-keyboard', 'class', 'data-theme'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    // Safety net for overlays that animate in without a DOM change near the bar (three
    // elementFromPoint reads, nothing sent unless the spec changed). It re-checks only when
    // something COULD have moved since the last tick — any DOM change at all (attributes beyond
    // the filter above too), a scroll, or a running animation. An idle page now costs nothing:
    // the unconditional 350 ms re-check kept the iPhone's web process at ~1.6% CPU while idle
    // (0.3% without it — performance audit 2026-10-19).
    let dirty = true
    const markDirty = () => { dirty = true }
    const anyChange = new MutationObserver(markDirty)
    anyChange.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    document.addEventListener('scroll', markDirty, { capture: true, passive: true })
    const animating = () => typeof document.getAnimations === 'function' && document.getAnimations().some((a) => a.playState === 'running')
    const iv = window.setInterval(() => { if (dirty || animating()) { dirty = false; schedule() } }, 350)
    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect(); mo.disconnect(); anyChange.disconnect()
      document.removeEventListener('scroll', markDirty, true)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      window.clearInterval(iv)
    }
  }, [native, clusterId])

  // Option changes (count badge, collapse, appearance) push at once.
  const optKey = JSON.stringify({ c: opts.collapsed, v: opts.visible, a: opts.appearance, ac: opts.accent, i: items.map((i) => [i.id, i.symbol, i.label, i.badge, i.title, i.subtitle, i.prominent]) })
  useEffect(() => {
    if (!native) return
    let alive = true
    void afterFirstPaint().then(() => { if (alive) sync.current() }) // same first-paint gate
    return () => { alive = false }
  }, [native, optKey])

  useEffect(() => {
    const a = liquidGlassAdapter()
    if (!native || !a?.onControlEvent) return
    const off = a.onControlEvent((e) => {
      if (e.cluster !== clusterId) return
      if (e.swipe) { optsRef.current.onSwipe?.(e.swipe); return }
      itemsRef.current.find((i) => i.id === e.item)?.onPress()
    })
    const me = owner.current
    return () => {
      off(); lastSent.current = ''; drawnAt.current.clear(); setShownKey('')
      // Only the instance that owns the cluster removes it; a newer instance mounted for the same
      // id (a remount) keeps its controls.
      const cur = clusterOwners.get(clusterId)
      if (!cur || cur === me) void a.removeControls?.(clusterId)
    }
  }, [native, clusterId])

  // Capabilities settled as non-native → the first-draw wait ends at once.
  useEffect(() => { if (!native && !nativePending) setFirstDrawDone(true) }, [native, nativePending])
  const shownSet = new Set(native && shownKey ? shownKey.split(',') : [])
  return { native, isNative: (id: string) => awaitingFirstDraw || shownSet.has(id) }
}

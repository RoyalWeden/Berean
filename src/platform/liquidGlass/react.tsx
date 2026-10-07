import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { liquidGlassAdapter, liquidGlassCapabilities, loadLiquidGlassCapabilities, subscribeLiquidGlass } from './capabilities'
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

export function useLiquidGlassControls(
  clusterId: string,
  items: LiquidGlassControlDef[],
  opts: { role: LiquidGlassOptions['role']; visible?: boolean; collapsed?: boolean; spacing?: number; appearance?: 'light' | 'dark' | null; accent?: string | null; onSwipe?: (dir: 'next' | 'previous') => void },
): { native: boolean; isNative: (id: string) => boolean } {
  const caps = useLiquidGlassCapabilities()
  const adapter = caps.native ? liquidGlassAdapter() : null
  const native = !!adapter?.controls
  // Which items the platform is drawing right now (not covered / off screen). A placeholder is
  // made invisible ONLY while its native twin is shown — otherwise the web control is the one seen.
  const [shownKey, setShownKey] = useState('')
  const itemsRef = useRef(items); itemsRef.current = items
  const optsRef = useRef(opts); optsRef.current = opts
  const lastRects = useRef<Record<string, LiquidGlassRect>>({})
  const lastSent = useRef('')
  // When each item's native twin was confirmed on screen (bridge call resolved).
  const drawnAt = useRef(new Map<string, number>())

  const sync = useRef(() => {})
  sync.current = () => {
    const a = liquidGlassAdapter()
    if (!a?.controls) return
    const o = optsRef.current
    const collapsed = !!o.collapsed
    const vw = window.innerWidth, vh = window.innerHeight
    const specItems = itemsRef.current.map((it) => {
      const el = it.ref.current
      let rect = lastRects.current[it.id]
      let hidden = !el
      if (el) {
        const r = el.getBoundingClientRect()
        const onScreen = r.width > 0 && r.height > 0 && r.bottom <= vh + 1 && r.top >= -1 && r.left >= -1 && r.right <= vw + 1
        // While collapsed the placeholder slides off-screen: keep its resting rect for the native
        // control (which animates the slide itself).
        if (onScreen && !collapsed) rect = lastRects.current[it.id] = { x: r.left, y: r.top, width: r.width, height: r.height }
        if (!collapsed) {
          if (!onScreen) hidden = true
          else {
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            hidden = !hit || !(hit === el || el.contains(hit))
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
    const spec = { id: clusterId, role: o.role ?? 'navigation', items: specItems, spacing: o.spacing ?? liquidGlassTokens('ios').groupSpacing, visible, collapsed, appearance: o.appearance !== undefined ? o.appearance : themeAppearance(), accent: o.accent !== undefined ? o.accent : themeAccent() }
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
    for (const id of [...drawn.keys()]) if (!shownIds.includes(id)) drawn.delete(id)
    const publish = () => {
      const now = performance.now()
      const ready = shownIds.filter((id) => { const t = drawn.get(id); return t !== undefined && now - t >= NATIVE_FADE_MS - 5 }).sort().join(',')
      setShownKey((k) => (k === ready ? k : ready))
    }
    publish() // anything no longer drawn natively shows its web placeholder at once
    const key = JSON.stringify(spec)
    const waiting = shownIds.filter((id) => !drawn.has(id))
    if (key === lastSent.current && waiting.length === 0) return
    const sent = key === lastSent.current ? Promise.resolve(true) : a.controls(spec)
    lastSent.current = key
    if (waiting.length) {
      void Promise.resolve(sent).then((ok) => {
        if (ok === false || lastSent.current !== key) return
        const t = performance.now()
        for (const id of waiting) if (!drawn.has(id)) drawn.set(id, t)
        window.setTimeout(() => sync.current(), NATIVE_FADE_MS)
      })
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
    mo.observe(document.body, { childList: true, subtree: true })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-keyboard', 'class', 'data-theme'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    // Safety net for overlays that animate in without a DOM change near the bar (cheap: three
    // elementFromPoint reads, and nothing is sent unless the spec changed).
    const iv = window.setInterval(schedule, 350)
    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect(); mo.disconnect()
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
    return () => { off(); lastSent.current = ''; drawnAt.current.clear(); setShownKey(''); void a.removeControls?.(clusterId) }
  }, [native, clusterId])

  const shownSet = new Set(native && shownKey ? shownKey.split(',') : [])
  return { native, isNative: (id: string) => shownSet.has(id) }
}

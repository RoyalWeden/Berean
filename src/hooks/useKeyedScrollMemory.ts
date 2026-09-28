import { useCallback, useEffect, useRef } from 'react'

/**
 * Per-key scroll memory for a surface that swaps between several scrollers inside one root —
 * the Scripture side panel's sub-tabs (cross references, notes, lexicon), and any other panel
 * with tabs. Each key keeps its own offset: switching away and back restores that key's
 * position instead of whatever the shared scroller last had (TEST-008).
 *
 * Why it is needed: the side panel keeps inactive sub-tabs mounted but `display:none`, and
 * Chromium/WebKit discard an element's scroll offset when its box is removed — so "kept
 * mounted" alone does not keep the position. Offsets are device-local presentation state
 * (never synced; see src/platform/sync/tabFields.ts LOCAL_FIELDS).
 *
 * Markup contract: each key's wrapper carries `data-scroll-key="<key>"`, and its scroller
 * carries `data-panel-scroll-root`.
 */
export function useKeyedScrollMemory<K extends string>(opts: {
  rootRef: React.RefObject<HTMLElement>
  activeKey: K
  initial?: Partial<Record<K, number>>
  /** Debounced persistence of the whole map (e.g. into the tab's local state). */
  onChange?: (offsets: Partial<Record<K, number>>) => void
  debounceMs?: number
}): { onScrollCapture: (e: React.UIEvent<HTMLElement>) => void; offsets: () => Partial<Record<K, number>> } {
  const { rootRef, activeKey, initial, onChange, debounceMs = 150 } = opts
  const mapRef = useRef<Partial<Record<K, number>>>({ ...(initial ?? {}) })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // While a restore is being applied the scroller emits its own scroll events (content still
  // loading → clamped offsets); those must not overwrite the remembered value.
  const restoringRef = useRef<K | null>(null)

  const onScrollCapture = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.target as HTMLElement
    if (!el.hasAttribute?.('data-panel-scroll-root')) return
    const key = (el.closest('[data-scroll-key]') as HTMLElement | null)?.dataset.scrollKey as K | undefined
    if (!key || restoringRef.current === key) return
    mapRef.current = { ...mapRef.current, [key]: el.scrollTop }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChangeRef.current?.(mapRef.current), debounceMs)
  }, [debounceMs])

  // Restore the newly-shown key. Content (cross refs, notes) often arrives a few frames after
  // the switch, so retry until the scroller is tall enough to hold the offset (≤ ~0.5 s).
  useEffect(() => {
    const target = mapRef.current[activeKey]
    if (target == null || target <= 0) return
    let frames = 0
    let raf = 0
    restoringRef.current = activeKey
    const apply = () => {
      const scroller = rootRef.current?.querySelector(`[data-scroll-key="${activeKey}"] [data-panel-scroll-root]`) as HTMLElement | null
      if (scroller) {
        scroller.scrollTop = target
        const fits = scroller.scrollHeight - scroller.clientHeight >= target
        if (fits || scroller.scrollTop === target || frames >= 30) { restoringRef.current = null; return }
      } else if (frames >= 30) { restoringRef.current = null; return }
      frames++
      raf = requestAnimationFrame(apply)
    }
    raf = requestAnimationFrame(apply)
    return () => { cancelAnimationFrame(raf); restoringRef.current = null }
  }, [activeKey, rootRef])

  // Flush on unmount so the last stretch of scrolling inside the debounce window is kept.
  useEffect(() => () => {
    if (timerRef.current) { clearTimeout(timerRef.current); onChangeRef.current?.(mapRef.current) }
  }, [])

  return { onScrollCapture, offsets: () => mapRef.current }
}

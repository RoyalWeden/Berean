/** Bottom safe-area inset in px (home indicator), measured once from env() — sheets add it to
 *  pixel detents so the special low position keeps the same visible height on every iPhone. */
let cached: number | null = null
export function safeAreaBottom(): number {
  if (cached != null) return cached
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden'
  document.body.appendChild(probe)
  cached = parseFloat(getComputedStyle(probe).paddingBottom) || 0
  probe.remove()
  return cached
}

let cachedTop: number | null = null
/** Top safe-area inset in px (status bar / notch / Dynamic Island), measured once from env(). */
export function safeAreaTop(): number {
  if (cachedTop != null) return cachedTop
  if (typeof document === 'undefined') return 0
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden'
  document.body.appendChild(probe)
  cachedTop = parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return cachedTop
}

/**
 * The shape at the top of the screen, from the top inset (no private device APIs): Dynamic Island
 * devices report ≥ 51 pt (59 on iPhone 14 Pro–16, 62 on 16 Pro), notch devices 44–50 pt, and
 * home-button devices 20 pt. The compact Scripture header (NEW-007) joins that shape.
 */
export type TopCutout = 'island' | 'notch' | 'none'
export function topCutout(top = safeAreaTop()): TopCutout {
  return top >= 51 ? 'island' : top >= 40 ? 'notch' : 'none'
}

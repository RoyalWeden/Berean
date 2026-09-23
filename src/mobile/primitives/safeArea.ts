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

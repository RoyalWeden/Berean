import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

/**
 * The ONE haptics vocabulary for the iPhone shell (TEST 2026-10-03: "more haptic feedback… feel
 * more fluid like iOS"). Pick by MEANING, not by strength:
 *
 *   tap       a floating control / button press (back, header circles, bottom controls)
 *   select    a value changed (segmented control, toggle, stepper, chip, picker row, sheet detent)
 *   navigate  a page / tab transition the user started (push, pop, edge swipe, tab switch)
 *   confirm   something completed successfully (Done, saved, copied, created)
 *   warn      a blocked or destructive step (nothing to go back to, delete)
 *   press     a long-press / lift (context preview, drag to reorder)
 *
 * The older names (light / medium / heavy / selection / success / warning) stay as aliases so the
 * existing call sites keep working. Every call is best-effort (a no-op in the web preview / a
 * simulator without a Taptic Engine) and throttled: one haptic per 35 ms, so a control whose own
 * handler and its primitive both fire can never double-buzz.
 */
let lastAt = 0

/**
 * Settings → Feedback → Haptic Feedback (TEST 2026-10-04: "haptics… mutable if settings allow").
 * A per-device preference (like iOS's own System Haptics switch), so it lives in this device's
 * local storage rather than the synced settings table. On by default.
 */
const HAPTICS_KEY = 'berean.haptics.enabled'
let enabled: boolean = (() => { try { return localStorage.getItem(HAPTICS_KEY) !== '0' } catch { return true } })()
const enabledListeners = new Set<() => void>()
export function hapticsEnabled(): boolean { return enabled }
export function setHapticsEnabled(v: boolean): void {
  enabled = v
  try { localStorage.setItem(HAPTICS_KEY, v ? '1' : '0') } catch { /* private / blocked storage — session only */ }
  enabledListeners.forEach((l) => l())
}
export function subscribeHapticsEnabled(l: () => void): () => void { enabledListeners.add(l); return () => { enabledListeners.delete(l) } }

function fire(run: () => Promise<void>): Promise<void> {
  if (!enabled) return Promise.resolve()
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - lastAt < 35) return Promise.resolve()
  lastAt = now
  return run().catch(() => {})
}

const impact = (style: ImpactStyle) => () => fire(() => Haptics.impact({ style }))
const notify = (type: NotificationType) => () => fire(() => Haptics.notification({ type }))
const selectionChanged = () => fire(() => Haptics.selectionChanged())

export const haptic = {
  tap: impact(ImpactStyle.Light),
  select: selectionChanged,
  navigate: impact(ImpactStyle.Light),
  confirm: notify(NotificationType.Success),
  warn: notify(NotificationType.Warning),
  press: impact(ImpactStyle.Medium),
  // aliases (existing call sites)
  light: impact(ImpactStyle.Light),
  medium: impact(ImpactStyle.Medium),
  heavy: impact(ImpactStyle.Heavy),
  selection: selectionChanged,
  success: notify(NotificationType.Success),
  warning: notify(NotificationType.Warning),
}

/** Tests only. */
export function _resetHapticThrottle(): void { lastAt = 0 }

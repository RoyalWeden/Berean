/**
 * Pure helpers for progress bar percentage calculation.
 * Exported so tests can verify every edge case without rendering.
 */

/**
 * Convert done/total counts into a CSS-safe percentage string clamped to [0, 100].
 * Handles all edge cases: zero total, done > total, NaN, negative values.
 */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(done) || done < 0) return 0
  return Math.min(100, Math.max(0, (done / total) * 100))
}

/**
 * Build the inline `width` style value for the progress bar element.
 * Always returns a valid CSS percentage string.
 */
export function progressWidth(done: number, total: number): string {
  return `${progressPercent(done, total)}%`
}

/**
 * Return true when the progress object represents a completed or terminal state
 * (done >= total). Used to decide whether to auto-hide the bar after a delay.
 */
export function progressComplete(done: number, total: number): boolean {
  return total > 0 && done >= total
}

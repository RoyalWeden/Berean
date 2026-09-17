/** Tiny class joiner — no tailwind-merge in this codebase, so callers must not pass
 *  conflicting utilities and expect the later one to win (see ActionPillGroup's note). */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(' ')
}

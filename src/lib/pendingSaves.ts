/**
 * Pending-save registry. Editors that debounce their writes (NotesPanel's 500 ms autosave)
 * register a flusher here, so a window that is about to go away — a floating tab being returned
 * to the main window, or closed — can write everything still waiting first (TEST 2026-10-10:
 * "returning the tab must not lose edits"). Per renderer (module scope), like the window itself.
 */
type Flusher = () => Promise<unknown> | void

const flushers = new Set<Flusher>()

export function registerPendingSaveFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => { flushers.delete(fn) }
}

/** Runs every flusher; resolves once their writes have been handed off (or failed). */
export async function flushPendingSaves(): Promise<void> {
  await Promise.allSettled([...flushers].map((f) => f()))
}

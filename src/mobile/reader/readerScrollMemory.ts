/**
 * Where each Scripture tab was scrolled on the phone (scroll-state audit, TEST-003 counterpart):
 * device-local and in-memory for the session (never synced — tabFields LOCAL_FIELDS rule). Keyed
 * by tab id and passage, so a remembered offset only applies to the chapter it was recorded in;
 * switching tabs (or tab cards) and coming back restores the reading position.
 */
const mem = new Map<string, { key: string; top: number }>()
export const readerScrollMemory = {
  save(tabId: string, passageKey: string, top: number) { mem.set(tabId, { key: passageKey, top }) },
  restore(tabId: string, passageKey: string): number | undefined {
    const m = mem.get(tabId)
    return m && m.key === passageKey ? m.top : undefined
  },
  forget(tabId: string) { mem.delete(tabId) },
}

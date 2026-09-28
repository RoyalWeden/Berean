import { useVerseSheets } from './verseSheets'

/**
 * The Compare page's touch interaction (R088): identical to the reader's verse model — see
 * verseSheets.tsx (tap adds / removes a verse → verse sheet at its low position; long-press →
 * native text selection; Strong's → Strong's sheet; notes open in the Notes space).
 *
 * The two columns select independently (T23-026/T23-028): the shared model keys a selection by
 * text, so tapping an LXX verse while KJV verses are selected starts a new LXX selection instead
 * of mixing the columns — scroll sync never couples selection.
 */
export function useCompareVerseInteraction(tabId?: string | null) {
  const { verseInteraction, openStrongs, openNoteInNotesSpace } = useVerseSheets({ tabId })
  return { verseInteraction, openStrongs, openNoteInNotesSpace }
}

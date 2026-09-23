import { useVerseSheets } from './verseSheets'

/**
 * The Compare page's touch interaction (R088): identical to the reader's verse model — see
 * verseSheets.tsx (tap selects a verse → verse sheet at its low position; long-press → native
 * text selection; Strong's → Strong's sheet; notes open in the Notes space).
 */
export function useCompareVerseInteraction(tabId?: string | null) {
  // The same verse model as the reader (tap / long-press / low-detent verse sheet).
  const { verseInteraction, openStrongs, openNoteInNotesSpace } = useVerseSheets({ tabId })
  return { verseInteraction, openStrongs, openNoteInNotesSpace }
}

import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { VerseInteraction } from '@/components/bible/verseInteraction'
import { useVerseSheets } from './verseSheets'

/**
 * The Compare page's touch interaction (R088): identical to the reader's verse model — see
 * verseSheets.tsx (tap selects a verse → verse sheet at its low position; long-press → native
 * text selection; Strong's → Strong's sheet; notes open in the Notes space).
 *
 * The two columns select independently (T23-026): a selection is keyed by text, so tapping
 * LXX Gen 1:3 while KJV Gen 1:3 is selected MOVES the selection to the LXX verse instead of the
 * reader's "same verse tapped again → deselect" (which compares book/chapter/verse only).
 */
export function useCompareVerseInteraction(tabId?: string | null) {
  const { verseInteraction: base, openStrongs, openNoteInNotesSpace } = useVerseSheets({ tabId })
  const verseInteraction = useMemo<VerseInteraction>(() => ({
    ...base,
    onVerseTap: (ctx) => {
      if (tabId) {
        const s = useAppStore.getState()
        const cur = s.selectedVersesByTab[tabId] ?? []
        const sameVerseOtherText = cur.length === 1 && cur[0].bookId === ctx.verse.book_id && cur[0].chapter === ctx.verse.chapter
          && cur[0].verse === ctx.verse.verse_num && (cur[0].textId ?? '') !== ctx.textId
        if (sameVerseOtherText) s.clearVerseSelection(tabId)
      }
      base.onVerseTap?.(ctx)
    },
  }), [base, tabId])
  return { verseInteraction, openStrongs, openNoteInNotesSpace }
}

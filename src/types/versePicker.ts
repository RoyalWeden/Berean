/** One side ("from" or "to") of the verse-tie picker window — a single chapter, with whatever
 *  verses are already selected (seeded from an existing tie reference, if the connection already
 *  had one). */
export interface VersePickerSide {
  bookId: string
  bookLabel: string
  chapter: number
  selected: number[]
}

export interface VersePickerPayload {
  connectionId: string
  from: VersePickerSide
  to: VersePickerSide
}

/** Sent live from the picker window back to whichever window opened it, every time a verse is
 *  clicked — "live-apply, close anytime" per how this was designed, no separate Done step. */
export interface VersePickerSelectionChange {
  connectionId: string
  side: 'from' | 'to'
  selected: number[]
}

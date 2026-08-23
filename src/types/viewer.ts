export type ViewerSidePanel =
  | { type: 'note'; noteId: string }
  | { type: 'lexicon'; strongsId: string }
  | { type: 'crossrefs'; bookId: string; chapter: number; source: 'tske' | 'classic' | 'notes'; activeVerse?: number }

export type ViewerPayload =
  | {
      kind: 'bible'
      bookId: string
      chapter: number
      verse?: number
      textId: string
      /** Annotation categories currently hidden in the main window (e.g. 'kjva_italics',
       *  'lxx_supply') — mirrored so toggling them there hides them in the presenter too. */
      hiddenAnnotations?: string[]
      sidePanel?: ViewerSidePanel
      /** 0–1 proportional scroll position of the chapter (set during scroll sync; absent on navigation) */
      scrollPercent?: number
      /** 0–1 proportional scroll position of the side panel */
      sidePanelScrollPercent?: number
    }
  | { kind: 'note'; noteId: string; scrollPercent?: number }
  | { kind: 'lexicon'; strongsId: string }
  | {
      kind: 'compare'
      columns: { textId: string; bookId: string; chapter: number }[]
      /** 0–1 proportional scroll position per column (index-aligned with `columns`), so each
       *  presenter column mirrors only the main column that was actually scrolled. */
      scrollPercents?: number[]
    }
  | { kind: 'idle' }

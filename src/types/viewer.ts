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
      sidePanel?: ViewerSidePanel
      /** 0–1 proportional scroll position of the chapter (set during scroll sync; absent on navigation) */
      scrollPercent?: number
      /** 0–1 proportional scroll position of the side panel */
      sidePanelScrollPercent?: number
    }
  | { kind: 'note'; noteId: string }
  | { kind: 'lexicon'; strongsId: string }
  | { kind: 'idle' }

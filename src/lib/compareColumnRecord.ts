import type { ScrollPosition } from './verseScrollSync'

/** Configuration metadata belongs to its column, including through reorders. */
export interface SavedCompareColumn {
  textId: string
  bookId: string
  chapter: number
  scrollPos?: ScrollPosition
  [key: string]: unknown
}

export function compareColumnOrderKey(columns: Array<{ id: string; textId: string; bookId: string; chapter: number }>): string {
  return JSON.stringify(columns.map(column => [column.id, column.textId, column.bookId, column.chapter]))
}

export function compareColumnRecord(column: {
  textId: string
  bookId: string
  chapter: number
  savedRecord?: SavedCompareColumn
}, scrollPos?: ScrollPosition): SavedCompareColumn {
  return {
    ...column.savedRecord,
    textId: column.textId,
    bookId: column.bookId,
    chapter: column.chapter,
    scrollPos,
  }
}

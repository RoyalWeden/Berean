// Books with unnumbered front matter (translator's prologue, etc.) stored as chapter 0 —
// kept out of the normal 1..chapters_count numbering so it never collides with the
// `verse === 0` "whole chapter reference" sentinel used throughout notes/cross-refs
// (see crossRefIndex.ts, noteRefs.ts). Only Sirach has this today (the KJV Apocrypha's
// traditional "Prologue of the Wisdom of Jesus the Son of Sirach").
const BOOKS_WITH_PROLOGUE = new Set(['SIR'])

export function hasPrologueChapter(bookId: string): boolean {
  return BOOKS_WITH_PROLOGUE.has(bookId)
}

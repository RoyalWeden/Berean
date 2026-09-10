// Books with unnumbered front matter (translator's prologue, etc.) stored as chapter 0 —
// kept out of the normal 1..chapters_count numbering so it never collides with the
// `verse === 0` "whole chapter reference" sentinel used throughout notes/cross-refs
// (see crossRefIndex.ts, noteRefs.ts).
//   SIR  — the KJV Apocrypha's "Prologue of the Wisdom of Jesus the Son of Sirach".
//   1CL  — 1 Clement's opening salutation ("The Church of God which sojourneth in
//          Rome..."); Lightfoot leaves it unnumbered ahead of ch 1, with 65 chapters
//          following (the DB previously numbered the salutation as ch 1, shifting
//          every subsequent chapter — DB 42 was really ch 41, etc.).
const BOOKS_WITH_PROLOGUE = new Set(['SIR', '1CL'])

export function hasPrologueChapter(bookId: string): boolean {
  return BOOKS_WITH_PROLOGUE.has(bookId)
}

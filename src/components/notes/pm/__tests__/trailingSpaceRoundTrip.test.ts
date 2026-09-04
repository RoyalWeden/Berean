import { describe, it, expect } from 'vitest'
import { bereanSchema as schema } from '../schema'
import { serializeToMarkdown } from '../serializer'
import { parseMarkdown } from '../parser'

// Regression for "Backspace at the end of a line also deletes the space before
// the last character". The delete transaction itself is correct — it removes
// exactly one character, leaving a trailing space on the line. The space then
// vanished because a space at the end of a markdown line is not representable:
// the serializer emits it but markdown-it strips it on the way back in, so the
// note's stored content (post save→parse) differs from the live doc by exactly
// that space, and NoteEditorPM's content-sync effect treated that as a real
// external edit and reparsed — dropping the space and resetting the caret.
//
// These tests pin the two facts the fix depends on:
//   1. markdown-it drops a lone trailing space on a line (so the fix is needed).
//   2. stripping per-line trailing whitespace makes the two strings compare
//      equal (so the content-sync guard can recognise the difference as inert).
describe('trailing-space markdown round-trip', () => {
  const docEndingWithSpace = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('alpha beta gamma ')]),
  ])

  it('the serializer preserves a trailing line space but the parser strips it', () => {
    const md = serializeToMarkdown(docEndingWithSpace)
    expect(md).toBe('alpha beta gamma ')
    expect(parseMarkdown(md).textContent).toBe('alpha beta gamma') // <- space gone
  })

  it('a trailing-whitespace-only difference is inert after per-line stripping', () => {
    const stripLineTrailingWs = (s: string) => s.replace(/[ \t]+$/gm, '')
    const live = serializeToMarkdown(docEndingWithSpace) // 'alpha beta gamma '
    const stored = serializeToMarkdown(parseMarkdown(live)) // 'alpha beta gamma'
    expect(live).not.toBe(stored)
    expect(stripLineTrailingWs(live)).toBe(stripLineTrailingWs(stored))
  })

  it('a genuine text edit is NOT masked by per-line stripping', () => {
    const stripLineTrailingWs = (s: string) => s.replace(/[ \t]+$/gm, '')
    expect(stripLineTrailingWs('alpha beta gamma ')).not.toBe(stripLineTrailingWs('alpha beta delta '))
  })

  it('a mid-document line ending in a space round-trips the same way', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('first line ')]),
      schema.node('paragraph', null, [schema.text('second line')]),
    ])
    const md = serializeToMarkdown(doc)
    const stripLineTrailingWs = (s: string) => s.replace(/[ \t]+$/gm, '')
    expect(stripLineTrailingWs(md)).toBe(stripLineTrailingWs(serializeToMarkdown(parseMarkdown(md))))
  })
})

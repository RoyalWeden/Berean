import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { bereanSchema as schema } from '../schema'
import { buildThread } from '../slashCommands'
import { threadIdsPresentInDoc } from '../threadCollapse'

function roundtrips(md: string) {
  return serializeToMarkdown(parseMarkdown(md))
}

const ONE_ENTRY_MD = [
  '<!-- berean:thread id="t1" title="Prayer log" -->',
  '<!-- berean:thread-entry id="e1" created="2026-08-22T10:30:00.000Z" -->',
  'First entry text.',
  '<!-- /berean:thread-entry -->',
  '<!-- /berean:thread -->',
].join('\n')

const TWO_ENTRY_NO_TITLE_MD = [
  '<!-- berean:thread id="t2" -->',
  '<!-- berean:thread-entry id="e1" created="2026-08-22T10:30:00.000Z" -->',
  'First entry.',
  '<!-- /berean:thread-entry -->',
  '<!-- berean:thread-entry id="e2" created="2026-08-22T11:00:00.000Z" -->',
  'Second entry.',
  '<!-- /berean:thread-entry -->',
  '<!-- /berean:thread -->',
].join('\n')

describe('threads — schema shape', () => {
  it('thread requires 1+ entries and thread_entry is not a bare "block" group member', () => {
    expect(schema.nodes.thread.spec.content).toBe('thread_entry+')
    expect(schema.nodes.thread_entry.spec.content).toBe('block+')
    expect(schema.nodes.thread_entry.spec.group).toBeUndefined()
    expect(schema.nodes.thread.spec.group).toBe('block')
  })

  it('buildThread() produces a schema-valid thread with one empty entry', () => {
    const t = buildThread()
    expect(() => t.check()).not.toThrow()
    expect(t.childCount).toBe(1)
    expect(typeof t.attrs.threadId).toBe('string')
    expect(t.attrs.threadId).not.toBe('')
    expect(t.attrs.title).toBeNull()
  })
})

describe('threads — round-trip (parseMarkdown -> serializeToMarkdown)', () => {
  it('a titled single-entry thread round-trips byte-identically', () => {
    expect(roundtrips(ONE_ENTRY_MD)).toBe(ONE_ENTRY_MD)
  })

  it('an untitled two-entry thread round-trips byte-identically (no title="" emitted)', () => {
    const out = roundtrips(TWO_ENTRY_NO_TITLE_MD)
    expect(out).toBe(TWO_ENTRY_NO_TITLE_MD)
    expect(out).not.toContain('title=')
  })

  it('parses threadId/title/entryId/createdAt attrs correctly', () => {
    const doc = parseMarkdown(ONE_ENTRY_MD)
    const thread = doc.firstChild!
    expect(thread.type.name).toBe('thread')
    expect(thread.attrs.threadId).toBe('t1')
    expect(thread.attrs.title).toBe('Prayer log')
    const entry = thread.firstChild!
    expect(entry.type.name).toBe('thread_entry')
    expect(entry.attrs.entryId).toBe('e1')
    expect(entry.attrs.createdAt).toBe('2026-08-22T10:30:00.000Z')
    expect(entry.textContent).toBe('First entry text.')
  })

  it('a title containing a double quote round-trips via the &quot; escape', () => {
    const md = [
      '<!-- berean:thread id="t3" title="a &quot;quoted&quot; word" -->',
      '<!-- berean:thread-entry id="e1" created="2026-08-22T10:30:00.000Z" -->',
      'text',
      '<!-- /berean:thread-entry -->',
      '<!-- /berean:thread -->',
    ].join('\n')
    const doc = parseMarkdown(md)
    expect(doc.firstChild!.attrs.title).toBe('a "quoted" word')
    expect(roundtrips(md)).toBe(md)
  })

  it('a malformed thread block (missing id) round-trips as literal plain text, not data loss', () => {
    const malformed = [
      '<!-- berean:thread -->',
      '<!-- berean:thread-entry id="e1" created="2026-08-22T10:30:00.000Z" -->',
      'text',
      '<!-- /berean:thread-entry -->',
      '<!-- /berean:thread -->',
    ].join('\n')
    const doc = parseMarkdown(malformed)
    expect(doc.firstChild!.type.name).not.toBe('thread')
    // The literal marker text must still be present somewhere in the doc — nothing dropped.
    expect(doc.textContent).toContain('berean:thread')
  })

  it('a thread nested inside a column round-trips correctly (recursive parse/serialize)', () => {
    const md = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      ONE_ENTRY_MD,
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      'plain right column',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    const columnList = doc.firstChild!
    expect(columnList.type.name).toBe('column_list')
    const firstColumn = columnList.firstChild!
    expect(firstColumn.firstChild!.type.name).toBe('thread')
  })

  it('a sub-thread nested inside a parent thread entry round-trips correctly (unbounded nesting)', () => {
    const md = [
      '<!-- berean:thread id="parent" title="Main thread" -->',
      '<!-- berean:thread-entry id="e1" created="2026-08-22T10:30:00.000Z" -->',
      'Parent entry text.',
      '<!-- /berean:thread-entry -->',
      '<!-- berean:thread-entry id="e2" created="2026-08-22T11:00:00.000Z" -->',
      '<!-- berean:thread id="child" title="Sub-thread" -->',
      '<!-- berean:thread-entry id="e3" created="2026-08-22T11:05:00.000Z" -->',
      'Child entry text.',
      '<!-- /berean:thread-entry -->',
      '<!-- /berean:thread -->',
      '<!-- /berean:thread-entry -->',
      '<!-- /berean:thread -->',
    ].join('\n')
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    const parent = doc.firstChild!
    expect(parent.type.name).toBe('thread')
    expect(parent.attrs.threadId).toBe('parent')
    const secondEntry = parent.child(1)
    expect(secondEntry.type.name).toBe('thread_entry')
    const child = secondEntry.firstChild!
    expect(child.type.name).toBe('thread')
    expect(child.attrs.threadId).toBe('child')
  })
})

describe('threadIdsPresentInDoc', () => {
  it('keeps only ids that still exist as real thread nodes in the doc', () => {
    const doc = parseMarkdown(TWO_ENTRY_NO_TITLE_MD)
    expect(threadIdsPresentInDoc(doc, ['t2', 'stale-id'])).toEqual(['t2'])
    expect(threadIdsPresentInDoc(doc, [])).toEqual([])
    expect(threadIdsPresentInDoc(doc, ['stale-only'])).toEqual([])
  })
})

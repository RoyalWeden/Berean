import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { buildStudyTrailEmbed } from '../slashCommands'
import { bereanSchema as schema } from '../schema'

function roundtrips(md: string) {
  return serializeToMarkdown(parseMarkdown(md))
}

describe('study_trail_embed markdown round-trip', () => {
  it('parses a standalone embed marker into a real node', () => {
    const md = '<!-- berean:study-trail id="sess-1" title="Romans study" connections="4" needsInput="1" -->'
    const doc = parseMarkdown(md)
    const node = doc.firstChild
    expect(node?.type.name).toBe('study_trail_embed')
    expect(node?.attrs.trailSessionId).toBe('sess-1')
    expect(node?.attrs.title).toBe('Romans study')
    expect(node?.attrs.connectionCount).toBe(4)
    expect(node?.attrs.needsInputCount).toBe(1)
  })

  it('round-trips through serialize -> parse unchanged', () => {
    const md = '<!-- berean:study-trail id="sess-2" title="Word study" connections="7" needsInput="0" -->'
    expect(roundtrips(md).trim()).toBe(md)
  })

  it('omits the title attribute entirely when title is empty, and still round-trips', () => {
    const node = buildStudyTrailEmbed('sess-3', '', 2, 0)
    const doc = schema.nodes.doc.create(null, node)
    const md = serializeToMarkdown(doc).trim()
    expect(md).not.toContain('title=')
    expect(md).toContain('id="sess-3"')
    const reparsed = parseMarkdown(md)
    expect(reparsed.firstChild?.attrs.trailSessionId).toBe('sess-3')
    expect(reparsed.firstChild?.attrs.title).toBe('')
  })

  it('coexists with surrounding paragraphs without disturbing them', () => {
    const md = [
      'Before the embed.',
      '',
      '<!-- berean:study-trail id="sess-4" title="Mixed content" connections="1" needsInput="0" -->',
      '',
      'After the embed.',
    ].join('\n')
    const doc = parseMarkdown(md)
    expect(doc.childCount).toBe(3)
    expect(doc.child(0).type.name).toBe('paragraph')
    expect(doc.child(1).type.name).toBe('study_trail_embed')
    expect(doc.child(2).type.name).toBe('paragraph')
  })

  it('escapes a quoted title through the attribute round-trip', () => {
    const node = buildStudyTrailEmbed('sess-5', 'A "quoted" title', 0, 0)
    const doc = schema.nodes.doc.create(null, node)
    const md = serializeToMarkdown(doc).trim()
    const reparsed = parseMarkdown(md)
    expect(reparsed.firstChild?.attrs.title).toBe('A "quoted" title')
  })
})

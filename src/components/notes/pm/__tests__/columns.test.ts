import { describe, it, expect } from 'vitest'
import { parseMarkdown } from '../parser'
import { serializeToMarkdown } from '../serializer'
import { bereanSchema as schema } from '../schema'
import { buildColumnList } from '../slashCommands'

function roundtrips(md: string) {
  return serializeToMarkdown(parseMarkdown(md))
}

const TWO_COL_MD = [
  '<!-- berean:columns -->',
  '<!-- berean:col -->',
  'Left column content.',
  '<!-- /berean:col -->',
  '<!-- berean:col -->',
  'Right column content.',
  '<!-- /berean:col -->',
  '<!-- /berean:columns -->',
].join('\n')

describe('side-by-side columns — schema shape', () => {
  it('column_list requires 2+ columns and column is not a bare "block" group member', () => {
    expect(schema.nodes.column_list.spec.content).toBe('column{2,}')
    expect(schema.nodes.column.spec.content).toBe('block+')
    expect(schema.nodes.column.spec.group).toBeUndefined()
    expect(schema.nodes.column_list.spec.group).toBe('block')
  })

  it('a column_list with exactly 2 empty-paragraph columns is schema-valid', () => {
    const list = buildColumnList(2)
    expect(() => list.check()).not.toThrow()
    expect(list.childCount).toBe(2)
  })
})

describe('side-by-side columns — round-trip (parseMarkdown -> serializeToMarkdown)', () => {
  it('hand-written 2-column markdown round-trips byte-identically', () => {
    expect(roundtrips(TWO_COL_MD)).toBe(TWO_COL_MD)
  })

  it('parses into a real column_list/column node tree, not plain paragraphs', () => {
    const doc = parseMarkdown(TWO_COL_MD)
    expect(doc.childCount).toBe(1)
    const list = doc.firstChild!
    expect(list.type.name).toBe('column_list')
    expect(list.childCount).toBe(2)
    expect(list.child(0).type.name).toBe('column')
    expect(list.child(0).textContent).toBe('Left column content.')
    expect(list.child(1).textContent).toBe('Right column content.')
  })

  it('PM doc -> markdown -> PM doc produces an identical doc (3 columns, mixed content)', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('Before.')]),
      schema.node('column_list', null, [
        schema.node('column', null, [
          schema.node('heading', { level: 2 }, [schema.text('Col A')]),
          schema.node('bullet_list', { tight: true, marker: '-' }, [
            schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('one')])]),
            schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('two')])]),
          ]),
        ]),
        schema.node('column', null, [schema.node('paragraph', null, [schema.text('Plain col B text.')])]),
        schema.node('column', null, [
          schema.node('callout', { calloutType: 'TIP' }, [schema.node('paragraph', null, [schema.text('A tip inside a column.')])]),
        ]),
      ]),
      schema.node('paragraph', null, [schema.text('After.')]),
    ])
    const md = serializeToMarkdown(doc)
    const reparsed = parseMarkdown(md)
    expect(reparsed.toJSON()).toEqual(doc.toJSON())
  })

  it('a heading + list inside one column survive round-trip with real block structure (not flattened to text)', () => {
    const md = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      '## Study points',
      '',
      '- first point',
      '- second point',
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      'Just a paragraph.',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    const doc = parseMarkdown(md)
    const list = doc.firstChild!
    expect(list.type.name).toBe('column_list')
    const colA = list.child(0)
    expect(colA.child(0).type.name).toBe('heading')
    expect(colA.child(0).attrs.level).toBe(2)
    expect(colA.child(1).type.name).toBe('bullet_list')
    expect(colA.child(1).childCount).toBe(2)
    expect(roundtrips(md)).toBe(md)
  })

  it('an empty column (no content) round-trips (column_list always keeps 2+ columns, one may be blank)', () => {
    const md = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      'Has content.',
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      '',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    const doc = parseMarkdown(md)
    const list = doc.firstChild!
    expect(list.childCount).toBe(2)
    expect(list.child(1).textContent).toBe('')
    expect(roundtrips(md)).toBe(md)
  })

  it('3+ columns round-trip', () => {
    const md = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      'A',
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      'B',
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      'C',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    expect(roundtrips(md)).toBe(md)
    expect(parseMarkdown(md).firstChild!.childCount).toBe(3)
  })

  it('columns surrounded by ordinary paragraphs round-trip, columns stay isolated from surrounding text', () => {
    const md = [
      'Some intro text before the layout.',
      '',
      TWO_COL_MD,
      '',
      'Some text after the layout.',
    ].join('\n')
    expect(roundtrips(md)).toBe(md)
    const doc = parseMarkdown(md)
    expect(doc.childCount).toBe(3)
    expect(doc.child(0).type.name).toBe('paragraph')
    expect(doc.child(1).type.name).toBe('column_list')
    expect(doc.child(2).type.name).toBe('paragraph')
  })

  it('two separate (sibling, non-nested) column_lists in one note both round-trip', () => {
    const secondList = TWO_COL_MD.replace('Left column content.', 'Second layout left.').replace('Right column content.', 'Second layout right.')
    const md = [TWO_COL_MD, '', secondList].join('\n')
    expect(roundtrips(md)).toBe(md)
    expect(parseMarkdown(md).childCount).toBe(2)
  })

  it('idempotent under repeated round-trips', () => {
    const once = roundtrips(TWO_COL_MD)
    const twice = roundtrips(once)
    expect(twice).toBe(once)
  })
})

describe('side-by-side columns — fenced code block masking', () => {
  it('does NOT treat literal berean:col/columns comment text inside a fenced code block as a real marker', () => {
    const md = [
      'Some text.',
      '',
      '```',
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      'example text pasted by a user, not a real column',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
      '```',
      '',
      'More text.',
    ].join('\n')
    const doc = parseMarkdown(md)
    let hasColumnList = false
    doc.descendants((n) => { if (n.type.name === 'column_list') hasColumnList = true })
    expect(hasColumnList).toBe(false)
    // Must still round-trip byte-identically as an ordinary fenced code block.
    expect(roundtrips(md)).toBe(md)
  })

  it('a real column_list whose OWN column contains a fenced code block round-trips, and a marker-lookalike line inside that nested fence is not mistaken for the real closing marker', () => {
    const md = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      'Left intro.',
      '',
      '```',
      '<!-- /berean:col -->',
      '```',
      '',
      'Left outro.',
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      'Right column, plain.',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    const doc = parseMarkdown(md)
    const list = doc.firstChild!
    expect(list.type.name).toBe('column_list')
    expect(list.childCount).toBe(2)
    const colA = list.child(0)
    // The fenced code block's literal "<!-- /berean:col -->" line must survive as CODE TEXT
    // inside colA, not have prematurely closed the column.
    let sawCodeBlockWithMarkerText = false
    colA.descendants((n) => {
      if (n.type.name === 'code_block' && n.textContent.includes('<!-- /berean:col -->')) sawCodeBlockWithMarkerText = true
    })
    expect(sawCodeBlockWithMarkerText).toBe(true)
    expect(colA.textContent).toContain('Left outro.')
    expect(roundtrips(md)).toBe(md)
  })
})

describe('side-by-side columns — malformed input falls back safely (no data loss, no throw)', () => {
  it('an unterminated <!-- berean:columns --> block does not throw and preserves the raw text', () => {
    const md = 'Before.\n\n<!-- berean:columns -->\n<!-- berean:col -->\nsome text\n<!-- /berean:col -->\n\nAfter (no closing columns marker).'
    expect(() => parseMarkdown(md)).not.toThrow()
    const doc = parseMarkdown(md)
    let hasColumnList = false
    doc.descendants((n) => { if (n.type.name === 'column_list') hasColumnList = true })
    expect(hasColumnList).toBe(false)
    expect(doc.textContent).toContain('some text')
    expect(doc.textContent).toContain('After (no closing columns marker).')
  })

  it('a columns block with only 1 column (fewer than the required 2) is left as plain text, not coerced into an invalid node', () => {
    const md = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      'Only one column here.',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    const doc = parseMarkdown(md)
    let hasColumnList = false
    doc.descendants((n) => { if (n.type.name === 'column_list') hasColumnList = true })
    expect(hasColumnList).toBe(false)
    expect(doc.textContent).toContain('Only one column here.')
    expect(() => doc.check()).not.toThrow()
  })

  it('never throws on null/undefined content with columns-related code paths involved', () => {
    // @ts-expect-error deliberately testing bad input
    expect(() => parseMarkdown(null)).not.toThrow()
    // @ts-expect-error deliberately testing bad input
    expect(() => parseMarkdown(undefined)).not.toThrow()
  })
})

describe('side-by-side columns — nesting (documented limitation)', () => {
  it('a column containing its own nested column_list DOES round-trip (recursive parseMarkdown call supports it, even though there is no editor UI to create it)', () => {
    const nestedMd = [
      '<!-- berean:columns -->',
      '<!-- berean:col -->',
      'Outer left, with a nested layout below:',
      '',
      TWO_COL_MD,
      '<!-- /berean:col -->',
      '<!-- berean:col -->',
      'Outer right.',
      '<!-- /berean:col -->',
      '<!-- /berean:columns -->',
    ].join('\n')
    const doc = parseMarkdown(nestedMd)
    const outerList = doc.firstChild!
    expect(outerList.type.name).toBe('column_list')
    const outerColA = outerList.child(0)
    let nestedListFound = false
    outerColA.descendants((n) => { if (n.type.name === 'column_list') nestedListFound = true })
    expect(nestedListFound).toBe(true)
    expect(roundtrips(nestedMd)).toBe(nestedMd)
  })
})

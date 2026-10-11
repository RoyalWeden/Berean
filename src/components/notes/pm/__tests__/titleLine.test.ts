import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { bereanSchema as schema } from '../schema'
import { selectionInTitleLine } from '../titleLinePlugin'

const h = (level: number, text: string) => schema.nodes.heading.create({ level }, schema.text(text))
const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text))

function stateAt(doc: ReturnType<typeof schema.node>, from: number, to = from) {
  const s = EditorState.create({ schema, doc })
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to)))
}

describe('selectionInTitleLine', () => {
  const doc = schema.node('doc', null, [h(1, 'Keyboard Shortcuts'), p('Body text')])
  const bodyPos = doc.firstChild!.nodeSize + 2

  it('is true with the cursor or a selection inside a leading H1', () => {
    expect(selectionInTitleLine(stateAt(doc, 1))).toBe(true)
    expect(selectionInTitleLine(stateAt(doc, 2, 8))).toBe(true)
  })

  it('is false in the body, or for a selection running from the title into the body', () => {
    expect(selectionInTitleLine(stateAt(doc, bodyPos))).toBe(false)
    expect(selectionInTitleLine(stateAt(doc, 2, bodyPos))).toBe(false)
  })

  it('is false when the first block is not a level-1 heading', () => {
    expect(selectionInTitleLine(stateAt(schema.node('doc', null, [h(2, 'Section'), p('x')]), 1))).toBe(false)
    expect(selectionInTitleLine(stateAt(schema.node('doc', null, [p('First'), h(1, 'Later')]), 1))).toBe(false)
  })
})

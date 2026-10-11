import { describe, it, expect } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { DecorationSet } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { createBlockDecorationsPlugin, blockDecorationsKey } from '../blockDecorations'
import { createSuppressRangesPlugin } from '../suppressRanges'
import { createRefDecorationsPlugin, refDecorationsKey, buildRefDecorationsForDoc } from '../refDecorations'

// The ref-decoration plugin updates INCREMENTALLY on doc changes (perf/glass QA P-03): only the
// changed textblocks (and blocks whose verse-block exclusions changed) are re-scanned. These
// tests pin that the incremental result is always identical to a full rebuild.

function flat(set: DecorationSet, size: number): string[] {
  return set.find(0, size)
    .map((d) => `${d.from}-${d.to}:${JSON.stringify((d as unknown as { type: { attrs: unknown } }).type.attrs)}`)
    .sort()
}

function full(state: EditorState): string[] {
  const block = blockDecorationsKey.getState(state) as DecorationSet | undefined
  return flat(buildRefDecorationsForDoc(state.doc, () => false, block), state.doc.content.size)
}

function makeState(md: string) {
  return EditorState.create({ schema, doc: parseMarkdown(md), plugins: [createBlockDecorationsPlugin(), createSuppressRangesPlugin(), createRefDecorationsPlugin()] })
}

// Deterministic pseudo-random sequence.
function rng(seed: number) { return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff } }

const SNIPPETS = ['x', ' ', 'John 3:16', ' Gen 1:1-3', 'H7225', ' #faith', 'LXX:Psalm 22:1', 'Romans 8:', '28', ' ']

describe('ref decorations — incremental == full rebuild', () => {
  const START = [
    '# Study', '', 'Plain paragraph with John 3:16 and H7225.', '',
    'Genesis 1:1', 'In the beginning God created the heaven and the earth.', '',
    '- list item Romans 8:28', '- second #faith', '', '> quoted Psalm 23:1', '',
    'Another paragraph mentioning LXX:Psalm 22:1 and G26.',
  ].join('\n')

  for (const seed of [1, 7, 42, 99, 2026]) {
    it(`random edit sequence (seed ${seed})`, () => {
      const r = rng(seed)
      let state = makeState(START)
      for (let step = 0; step < 120; step++) {
        const size = state.doc.content.size
        const pos = 1 + Math.floor(r() * Math.max(1, size - 2))
        const $p = state.doc.resolve(Math.min(pos, size - 1))
        let tr = state.tr
        const kind = r()
        try {
          if (kind < 0.55 && $p.parent.isTextblock) tr = tr.insertText(SNIPPETS[Math.floor(r() * SNIPPETS.length)], $p.pos)
          else if (kind < 0.8) { const to = Math.min(size - 1, $p.pos + 1 + Math.floor(r() * 12)); tr = tr.delete($p.pos, to) }
          else if ($p.parent.isTextblock) tr = tr.setSelection(TextSelection.create(tr.doc, $p.pos)).split($p.pos)
          else continue
        } catch { continue }
        if (!tr.docChanged) continue
        state = state.apply(tr)
        const inc = flat(refDecorationsKey.getState(state) as DecorationSet, state.doc.content.size)
        expect(inc, `step ${step}`).toEqual(full(state))
      }
    })
  }

  it('typing a reference line above a verse body still matches a full rebuild', () => {
    let state = makeState('Intro\n\nIn the beginning God created the heaven and the earth.')
    const end = state.doc.child(0).nodeSize - 1
    for (const ch of ' Genesis 1:1') {
      state = state.apply(state.tr.insertText(ch, state.doc.child(0).nodeSize - 1))
      expect(flat(refDecorationsKey.getState(state) as DecorationSet, state.doc.content.size)).toEqual(full(state))
    }
    expect(end).toBeGreaterThan(0)
  })
})

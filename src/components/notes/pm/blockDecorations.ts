import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { parseRef } from '@/lib/parseRef'
import {
  SINGLE_VERSE_LINE_RE, VERSE_BODY_LINE_RE, LEXICON_BLOCK_HEADER_RE,
  stripLxxMarker, splitLeadingLxx, verseTextAccepted,
} from '@/lib/noteTextBlocks'
import { useAppStore } from '@/store'

// Port of NoteEditor.tsx's verse-block (NoteEditor.tsx:1609-1664) and
// lexicon-block (1666-1696) live-decoration logic. Both operate on "lines" —
// in the CM6 flat-text model that's just `doc.line(n)`, with no distinction
// between a line break and a new block. PM has no such thing: pressing
// Enter (the ordinary way anyone types a multi-line verse/lexicon block)
// creates a NEW PARAGRAPH NODE, not a hard_break within one paragraph —
// hard_break only happens via Shift+Enter or when parsing a bare '\n' from
// existing markdown text (markdownIt.ts's `breaks: true`). An earlier
// version of this file only reconstructed "lines" by splitting a SINGLE
// paragraph's hard_break children, so any block typed the normal way (one
// Enter per line) was invisible to detection entirely — this rewrite walks
// consecutive TOP-LEVEL paragraph siblings too, flattening both intra-
// paragraph hard-break lines AND inter-paragraph lines into one sequential
// "lines" list, so multi-line detection works regardless of which way the
// line breaks were produced.
//
// Visual: a block can therefore span MULTIPLE paragraph nodes. Since PM has
// no "decorate N sibling nodes as one visual unit" primitive, each
// paragraph that's part of the block gets its own `Decoration.node` with a
// `-first`/`-middle`/`-last`/`-only` modifier class, and pmEditor.css
// removes the margin/border-radius between them so they read as one
// continuous rectangle — the same technique multi-paragraph blockquotes use
// under the hood, just applied manually since these aren't a single real
// wrapping node.

export const blockDecorationsKey = new PluginKey('berean-block-decorations')
const refreshMeta = 'berean-refresh-block-decorations'

interface LineInfo { text: string; from: number; to: number; paraPos: number; paraSize: number }

// Flattens consecutive top-level PARAGRAPH siblings (breaking the run at
// any non-paragraph block — heading, list, table, blockquote, code_block,
// callout — since a verse/lexicon block only makes sense within contiguous
// plain paragraphs) into one sequential lines list, recording which
// paragraph (by position/size) each line came from.
function collectLineRuns(doc: PMNode): LineInfo[][] {
  const runs: LineInfo[][] = []
  let current: LineInfo[] = []
  const flush = () => { if (current.length) runs.push(current); current = [] }

  doc.forEach((node, offset) => {
    if (node.type.name !== 'paragraph' || node.type.spec.code) { flush(); return }
    const base = offset + 1
    let cur = ''
    let curFrom = base
    let pos = base
    node.forEach((child) => {
      if (child.type.name === 'hard_break') {
        current.push({ text: cur, from: curFrom, to: pos, paraPos: offset, paraSize: node.nodeSize })
        cur = ''
        curFrom = pos + child.nodeSize
      } else {
        cur += child.text ?? ''
      }
      pos += child.nodeSize
    })
    current.push({ text: cur, from: curFrom, to: pos, paraPos: offset, paraSize: node.nodeSize })
  })
  flush()
  return runs
}

export function createBlockDecorationsPlugin() {
  // Captured via the plugin's view() lifecycle hook below — needed because
  // `props.decorations(state)` only receives `state`, not a live view
  // reference, but the async verse-text verification (verseTextAccepted,
  // which calls window.bible.queryChapter) needs to dispatch a transaction
  // once it resolves, to force decorations to recompute — mirrors the CM6
  // version's `refreshDecorationsEffect` dispatch from inside its own
  // decoration builder.
  let liveView: EditorView | null = null

  return new Plugin({
    key: blockDecorationsKey,
    state: {
      init: () => 0,
      apply: (tr, token) => (tr.getMeta(refreshMeta) ? token + 1 : token),
    },
    view(view) {
      liveView = view
      return { destroy: () => { liveView = null } }
    },
    props: {
      decorations(state) {
        return buildBlockDecorations(state.doc, () => {
          if (liveView) liveView.dispatch(liveView.state.tr.setMeta(refreshMeta, true))
        })
      },
    },
  })
}

type BlockKind = 'verse' | 'lexicon'
interface DetectedBlock {
  kind: BlockKind
  startLine: number
  endLine: number
  refFrom: number
  refTo: number
  // Carried through to the `-ref` decoration's data-* attrs so
  // createRefClickPlugin (refDecorations.ts) can open the right verse/
  // lexicon entry on click without needing to re-parse the rendered
  // textContent — the exact same attr shape createRefDecorationsPlugin's
  // own pm-verse-ref/pm-lxx-ref/pm-lexicon-ref decorations already use.
  refText: string
  lxx?: boolean
  strongsId?: string
}

// Exported for staticRender.ts — the read-only version-history/print/daily-
// scroll/Presenter renderer reuses this exact detection logic (rather than
// re-implementing it) so a block that's boxed in the live editor is boxed
// identically everywhere else, with zero risk of the two ever drifting out
// of sync.
export function buildBlockDecorations(doc: PMNode, onResolved: () => void): DecorationSet {
  const decorations: Decoration[] = []
  const noteScriptureBlock = useAppStore.getState().noteScriptureBlock
  const threshold = useAppStore.getState().noteScriptureBlockThreshold ?? 0.9

  for (const lines of collectLineRuns(doc)) {
    const blocks: DetectedBlock[] = []

    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.text.trim()
      if (!trimmed) { i++; continue }

      if (noteScriptureBlock) {
        // A) Multi-line verse block: ref line + following numbered verse lines.
        const strippedRefLine = stripLxxMarker(trimmed)
        const bareRefLine = strippedRefLine.ref
        if (trimmed.includes(':') && parseRef(bareRefLine) && i + 1 < lines.length && VERSE_BODY_LINE_RE.test(lines[i + 1].text)) {
          let end = i + 1
          while (end + 1 < lines.length && VERSE_BODY_LINE_RE.test(lines[end + 1].text)) end++
          const bodyParts = lines.slice(i + 1, end + 1).map((l) => l.text.replace(/^\s*\d{1,3}[ \t]+/, ''))
          const accepted = verseTextAccepted(trimmed, bodyParts.join(' '), threshold, onResolved)
          if (accepted !== false) {
            blocks.push({ kind: 'verse', startLine: i, endLine: end, refFrom: line.from, refTo: line.to, refText: bareRefLine, lxx: strippedRefLine.lxx })
          }
          i = end + 1
          continue
        }

        // B) Single-line verse block: "Book c:v verse text…"
        const m = SINGLE_VERSE_LINE_RE.exec(line.text)
        if (m) {
          const { refLabel, body } = splitLeadingLxx(m[2], m[3])
          const strippedRef = stripLxxMarker(refLabel)
          if (parseRef(strippedRef.ref)) {
            const accepted = verseTextAccepted(refLabel, body, threshold, onResolved)
            if (accepted !== false) {
              const refFrom = line.from + m[1].length
              const refTo = refFrom + m[2].length
              blocks.push({ kind: 'verse', startLine: i, endLine: i, refFrom, refTo, refText: strippedRef.ref, lxx: strippedRef.lxx })
            }
          }
        }
      }

      // Lexicon blocks: NOT gated by noteScriptureBlock (matches NoteEditor.tsx).
      if (LEXICON_BLOCK_HEADER_RE.test(trimmed) && i + 1 < lines.length) {
        const defLine = lines[i + 1]
        const defTrimmed = defLine.text.trim()
        if (defTrimmed.length > 0 && !defTrimmed.startsWith('#')) {
          const numM = /^([HG]\d{1,5})/.exec(trimmed)
          blocks.push({
            kind: 'lexicon', startLine: i, endLine: i + 1,
            refFrom: numM ? line.from + (line.text.length - line.text.trimStart().length) : line.from,
            refTo: numM ? (line.from + (line.text.length - line.text.trimStart().length)) + numM[1].length : line.from,
            refText: numM?.[1] ?? '',
            strongsId: numM?.[1]?.toUpperCase(),
          })
          i += 2
          continue
        }
      }

      i++
    }

    for (const block of blocks) {
      const boxClass = block.kind === 'verse' ? 'pm-verse-block' : 'pm-lexicon-block'

      // Unique paragraphs spanned by this block, in order.
      const paraKeys: string[] = []
      const paraByKey = new Map<string, { pos: number; size: number }>()
      for (let j = block.startLine; j <= block.endLine; j++) {
        const key = `${lines[j].paraPos}`
        if (!paraByKey.has(key)) {
          paraByKey.set(key, { pos: lines[j].paraPos, size: lines[j].paraSize })
          paraKeys.push(key)
        }
      }

      // Only box the WHOLE paragraph as a rectangle when the block occupies
      // that paragraph's entire line range (the normal case). If a
      // paragraph is only PARTIALLY covered (shares lines with unrelated
      // text — only possible via hard_break lines within one paragraph,
      // since inter-paragraph lines always fully belong to their own
      // paragraph), fall back to per-line inline styling for that
      // paragraph's lines instead of boxing unrelated text too.
      paraKeys.forEach((key, idx) => {
        const para = paraByKey.get(key)!
        const linesInPara = lines.filter((l) => l.paraPos === para.pos)
        const linesInParaWithinBlock = lines
          .slice(block.startLine, block.endLine + 1)
          .filter((l) => l.paraPos === para.pos)
        const wholeParaCovered = linesInParaWithinBlock.length === linesInPara.length

        if (wholeParaCovered) {
          const position = paraKeys.length === 1 ? 'only' : idx === 0 ? 'first' : idx === paraKeys.length - 1 ? 'last' : 'middle'
          decorations.push(Decoration.node(para.pos, para.pos + para.size, { class: `${boxClass} ${boxClass}-${position}` }))
        } else {
          for (const l of linesInParaWithinBlock) {
            decorations.push(Decoration.inline(l.from, l.to, { class: `${boxClass}-line` }))
          }
        }
      })

      decorations.push(Decoration.inline(block.refFrom, block.refTo, {
        class: `${boxClass}-ref`,
        ...(block.kind === 'verse' ? { 'data-ref': block.refText, 'data-lxx': block.lxx ? 'true' : 'false' } : {}),
        ...(block.kind === 'lexicon' ? { 'data-strongs-id': block.strongsId ?? '' } : {}),
      }))
      // Lexicon blocks' 2nd line (the definition) stays italic regardless
      // of whether the whole-paragraph box or the per-line fallback applied.
      if (block.kind === 'lexicon' && lines[block.endLine]) {
        const defLine = lines[block.endLine]
        decorations.push(Decoration.inline(defLine.from, defLine.to, { class: 'pm-lexicon-block-def' }))
      }
    }
  }

  return DecorationSet.create(doc, decorations)
}

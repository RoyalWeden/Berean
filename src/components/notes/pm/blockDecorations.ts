import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { parseRef } from '@/lib/parseRef'
import {
  SINGLE_VERSE_LINE_RE, VERSE_BODY_LINE_RE, LEXICON_BLOCK_HEADER_RE,
  stripLxxMarker, splitLeadingLxx, verseTextAccepted, normalizeRefWhitespace,
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
        // Normalise nbsp/thin spaces to a plain space (length-preserving, so every
        // from/to offset below stays valid) — contenteditable swaps typed spaces for
        // U+00A0, which the verse-block regexes' `[ \t]` gaps don't accept.
        cur += normalizeRefWhitespace(child.text ?? '')
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
  function refreshOnResolve() {
    if (liveView) liveView.dispatch(liveView.state.tr.setMeta(refreshMeta, true))
  }

  return new Plugin({
    key: blockDecorationsKey,
    // Was a plain refresh-token counter — decorations(state) below ignored it entirely and
    // called buildBlockDecorations(state.doc, ...) unconditionally on EVERY call, which
    // prosemirror-view makes on effectively every redraw, including pure selection changes
    // (arrow keys, clicks) with no doc change at all. Unlike refDecorations.ts's own plugin
    // (which already correctly caches its DecorationSet in plugin state and bails when
    // `!tr.docChanged`), every cursor move here repaid a full-document verse/lexicon-block
    // detection walk for no reason. Now caches the real DecorationSet in plugin state, same
    // gating condition (docChanged OR the refresh meta this plugin's own async verse-lookup
    // callback sets) refDecorations.ts already uses — `old.map(tr.mapping, tr.doc)` cheaply
    // remaps the cached set forward for anything else (selection-only transactions).
    // The refresh callback closes over the OUTER `liveView` variable rather than taking a
    // snapshot of it, so it's safe to use the exact same callback in `init` (which runs before
    // the view() hook below sets liveView) as in `apply` — by the time an async verse-text
    // lookup actually RESOLVES and this callback runs, `view()` has always already run (the
    // EditorView constructor calls it synchronously, well before any DB round-trip resolves).
    // An earlier version of this used a no-op callback in init specifically, on the theory that
    // liveView wasn't available yet — that broke the refresh entirely for the single most common
    // case a plugin state machine like this needs to handle: opening a note that ALREADY
    // contains an unverified verse-like block, so init's build is the ONLY one that ever fires
    // for that lookup (verseTextAccepted's own pending-promise cache means a later apply() call
    // for the same candidate text is just a cache hit, not a fresh request that could rebind a
    // "real" callback) — the checking pulse never resolved to either boxed or plain.
    state: {
      init: (_, state) => buildBlockDecorations(state.doc, refreshOnResolve),
      apply(tr, old, _oldState, newState) {
        if (!tr.docChanged && !tr.getMeta(refreshMeta)) return old.map(tr.mapping, tr.doc)
        return buildBlockDecorations(newState.doc, refreshOnResolve)
      },
    },
    view(view) {
      liveView = view
      // buildBlockDecorations reads noteScriptureBlock/noteScriptureBlockThreshold as a plain
      // useAppStore.getState() snapshot each time it runs — but it only RUNS when ProseMirror
      // actually redraws (i.e. on a dispatched transaction). If the setting flips with no
      // transaction in between — the persist-middleware store rehydrating shortly after the
      // editor already mounted with its default (false) value being the common real-world
      // case, or the user toggling the setting in Settings while a note is open — the verse
      // block stays exactly as stale as it was at the last real transaction, reading as
      // "doesn't format until I click/type something." Subscribing here and forcing the same
      // refresh transaction the async verse-text-verification path already uses closes that
      // gap for every future settings-gated decoration, not just this one.
      const unsubscribe = useAppStore.subscribe((state, prevState) => {
        if (state.noteScriptureBlock === prevState.noteScriptureBlock
          && state.noteScriptureBlockThreshold === prevState.noteScriptureBlockThreshold) return
        if (liveView) liveView.dispatch(liveView.state.tr.setMeta(refreshMeta, true))
      })
      return { destroy: () => { liveView = null; unsubscribe() } }
    },
    props: {
      decorations(state) {
        return this.getState(state)
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
        // Blank paragraphs (a real Enter-Enter gap, or a blank <p> from a rich
        // clipboard paste) can sit between the ref and the first verse, and
        // between verses — skip over them when looking ahead for the next
        // body line, but still fold them into the block's line range so the
        // box decoration below spans the gap instead of stopping short.
        const strippedRefLine = stripLxxMarker(trimmed)
        const bareRefLine = strippedRefLine.ref
        let firstBodyIdx = i + 1
        while (firstBodyIdx < lines.length && !lines[firstBodyIdx].text.trim()) firstBodyIdx++
        // VERSE_BODY_LINE_RE alone ("digit(s) + whitespace + text") can't tell a verse-number
        // body line ("6 And Seth lived...") apart from a numbered-book reference's OWN ref+body
        // line ("2 Peter 3:5 this talks about..." / "1 John 2:4-5 ...") — both match it. A blank
        // line correctly separating two stacked blocks got ignored whenever the SECOND block
        // happened to start with a numbered book, merging them into one. Exclude anything that
        // ALSO looks like a full "Book c:v body" line itself (SINGLE_VERSE_LINE_RE) — that's a
        // new block starting, not a continuation of this one. Also exclude a BARE reference line
        // with no body attached ("1 John 2:4-5" on its own line, the ref line of a new MULTI-line
        // block) — VERSE_BODY_LINE_RE's "digit + whitespace + text" shape matches that too (the
        // leading "1" reads as a verse number), and it doesn't carry trailing body text for
        // SINGLE_VERSE_LINE_RE to reject on its own.
        const isBodyContinuation = (t: string) => VERSE_BODY_LINE_RE.test(t) && !SINGLE_VERSE_LINE_RE.test(t) && !parseRef(t.trim())
        if (trimmed.includes(':') && parseRef(bareRefLine) && firstBodyIdx < lines.length && isBodyContinuation(lines[firstBodyIdx].text)) {
          let end = firstBodyIdx
          while (true) {
            let next = end + 1
            while (next < lines.length && !lines[next].text.trim()) next++
            if (next < lines.length && isBodyContinuation(lines[next].text)) { end = next; continue }
            break
          }
          const bodyParts = lines.slice(i + 1, end + 1)
            .filter((l) => l.text.trim())
            .map((l) => l.text.replace(/^\s*\d{1,3}[ \t]+/, ''))
          // === true, not "!== false" — verseTextAccepted returns null while verification is
          // still pending, and null !== false, so a still-unresolved candidate rendered as
          // accepted IMMEDIATELY (every keystroke invalidates the cache key, so this was
          // effectively always true while actively typing). Fail closed on pending too: don't
          // show the block until verification actually resolves one way or the other.
          const accepted = verseTextAccepted(trimmed, bodyParts.join(' '), threshold, onResolved)
          if (accepted === true) {
            blocks.push({ kind: 'verse', startLine: i, endLine: end, refFrom: line.from, refTo: line.to, refText: bareRefLine, lxx: strippedRefLine.lxx })
          } else if (accepted === null) {
            // Fluid-feel polish #2.2: while verification is still pending (the async
            // window.bible.queryChapter round-trip inside verseTextAccepted hasn't resolved
            // yet), mark the reference line with a brief "checking" micro-state instead of
            // leaving it as fully plain text. Does NOT change the fail-closed accept/reject
            // logic above — this is purely a visual bridge so the transition from "unboxed"
            // to "boxed" reads as one continuous animation instead of an abrupt pop once the
            // lookup resolves (see pmEditor.css's .pm-verse-block-checking pulse).
            decorations.push(Decoration.inline(line.from, line.to, { class: 'pm-verse-block-checking' }))
          }
          i = end + 1
          continue
        }

        // B) Single-line verse block: "Book c:v verse text…"
        const m = SINGLE_VERSE_LINE_RE.exec(line.text)
        if (m) {
          const { refLabel, body, markerLen } = splitLeadingLxx(m[2], m[3])
          const strippedRef = stripLxxMarker(refLabel)
          if (parseRef(strippedRef.ref)) {
            const accepted = verseTextAccepted(refLabel, body, threshold, onResolved)
            const refFrom = line.from + m[1].length
            // + markerLen: when the "LXX" marker came from the FRONT of the body (m[3], not
            // the ref-only m[2]) rather than the ref's own trailing text, extend the span to
            // cover it too — see splitLeadingLxx's doc comment for why the ref-only length
            // alone leaves "LXX" out of the styled span.
            const refTo = refFrom + m[2].length + markerLen
            if (accepted === true) {
              blocks.push({ kind: 'verse', startLine: i, endLine: i, refFrom, refTo, refText: strippedRef.ref, lxx: strippedRef.lxx })
            } else if (accepted === null) {
              // Same "checking" micro-state as the multi-line branch above, scoped to just
              // the reference span (not the whole line) since the single-line form has body
              // text sharing the same line as the ref.
              decorations.push(Decoration.inline(refFrom, refTo, { class: 'pm-verse-block-checking' }))
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

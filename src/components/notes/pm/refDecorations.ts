import { Plugin, PluginKey, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { parseRef, type ParsedRef } from '@/lib/parseRef'
import { findVerseRefMatches, normalizeRefWhitespace } from '@/lib/noteTextBlocks'
import { suppressRangesKey } from './suppressRanges'
import { buildBlockDecorations, blockDecorationsKey } from './blockDecorations'

// Mirrors NoteEditor.tsx's buildLiveDecorations regex set exactly (verse-ref
// scanning is centralized in the exported `findVerseRefMatches`; lxx-prefix
// and lexicon-ref regexes are local consts there too, duplicated here since
// they're simple one-liners not worth threading through an export).
const LXX_PREFIX_RE = /\b(?:lxx|LXX):(?:[1-3][ \t]*)?[A-Za-z][a-z]+(?:[ \t]+(?:of[ \t]+)?[A-Za-z][a-z]+)?[ \t]+\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?\b/g
const LEXICON_REF_RE = /\b[HGhg]\d{1,5}\b/g
// "#tag" inline reference — "#" after start-of-line/whitespace, then a word char run.
// Not preceded by a word char (so `a#b` doesn't match); a bare "# " heading never matches
// (needs a word char right after "#"). Group 1 is the tag name; the match includes the "#".
const TAG_REF_RE = /(?:^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu

// Doc-only variant of buildDecorations (below), reused by staticRender.ts's
// read-only renderer (version history, print/export, daily scroll,
// Presenter) — those have no EditorState/suppress-range state at all, so
// `isSuppressed` defaults to "nothing is suppressed."
export function buildRefDecorationsForDoc(
  doc: PMNode,
  isSuppressed: (from: number, to: number) => boolean = () => false,
  // Optional pre-computed block-decoration set, so the LIVE editor path (buildDecorations below)
  // can reuse blockDecorations.ts's own already-cached DecorationSet instead of recomputing the
  // same full-document verse/lexicon-block detection walk a SECOND time on every keystroke — this
  // function used to unconditionally call buildBlockDecorations(doc, ...) itself here purely to
  // get `-ref`/`-def` exclusion ranges, duplicating the exact work blockDecorations.ts's own
  // plugin was already doing. Left undefined (computed fresh) for callers with no live plugin
  // state to read from — staticRender.ts's read-only renderer (version history, print/export,
  // daily scroll, Presenter), which only runs once per render, not per keystroke, so recomputing
  // there isn't the hot-path cost this was about.
  blockDecorationSet?: DecorationSet,
): DecorationSet {
  const decorations: Decoration[] = []

  // Two more reasons a range should be skipped, beyond the caller's own
  // isSuppressed: (1) a wikilink's title text can itself look like a verse
  // reference or Strong's number (e.g. `[[Genesis 1:1]]`, `[[H7225]]`) — it
  // already has its own pill styling and shouldn't ALSO get the generic
  // verse-ref/lexicon-ref underline stacked on top; (2) a verse/lexicon
  // BLOCK's own reference line already gets bold-accent `-ref` styling from
  // blockDecorations.ts — without this exclusion the exact same span was
  // ALSO matched by the general scans below, landing two decorations on one
  // span (`class="pm-verse-block-ref pm-verse-ref"`) whose rules disagree
  // (the general one adds an underline the block-ref styling never wanted).
  // Deliberately only excludes `-ref`/`-def` spans (the reference/
  // definition LINE itself), not the whole block — Strong's numbers
  // legitimately appearing in ordinary verse BODY text still need their own
  // ref styling.
  const blockRefRanges: Array<{ from: number; to: number }> = []
  ;(blockDecorationSet ?? buildBlockDecorations(doc, () => {})).find(0, doc.content.size).forEach((d) => {
    const cls = (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class ?? ''
    if (/-(ref|def)\b/.test(cls)) blockRefRanges.push({ from: d.from, to: d.to })
  })
  const isBlockRefCovered = (from: number, to: number) => blockRefRanges.some((r) => r.from < to && r.to > from)

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false

    // node.textContent flattens ALL inline children to their text, including non-text
    // leaf children (hard_break, image) — which contribute ZERO characters to textContent
    // even though each still occupies real document position space (nodeSize 1). Regex
    // match indices computed against that flattened string were then off by however many
    // such leaf nodes preceded the match, so `base + match.index` pointed too early and
    // `base + match.index + match.length` landed one position short of the reference's
    // true end — the reported bug: a verse ref written on its own line after a hard line
    // break ("hosea 6;\njubilees 4:30") had its underline/color decoration silently
    // truncated by exactly one character (dropping the ref's last digit) because the
    // hard_break between the two lines "disappeared" from the string but not from the
    // document's coordinate space. Building the string by hand — inserting one placeholder
    // space per position a non-text leaf child actually occupies — keeps every string
    // index in 1:1 correspondence with a real document position, so `base + index` is
    // always correct regardless of how many hard_breaks/images sit earlier in the block.
    let text = ''
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : ' '.repeat(child.nodeSize)
    })
    // nbsp/thin-space → plain space (length-preserving, so `base + match.index` stays
    // exact) — contenteditable substitutes typed spaces with U+00A0, which the ref
    // regexes' `[ \t]` gaps reject, so "Isaiah 61:3<nbsp>LXX" never matched the marker.
    text = normalizeRefWhitespace(text)
    const base = pos + 1

    // Wikilink-marked ranges within this textblock, computed once by
    // walking its inline children.
    const wikilinkRanges: Array<{ from: number; to: number }> = []
    let walkPos = base
    node.forEach((child) => {
      if (child.marks.some((m) => m.type.name === 'wikilink')) {
        wikilinkRanges.push({ from: walkPos, to: walkPos + child.nodeSize })
      }
      walkPos += child.nodeSize
    })
    const isWikilinked = (from: number, to: number) => wikilinkRanges.some((r) => r.from < to && r.to > from)
    const shouldSkip = (from: number, to: number) => isSuppressed(from, to) || isBlockRefCovered(from, to) || isWikilinked(from, to)

    const lxxRanges: Array<{ from: number; to: number }> = []
    LXX_PREFIX_RE.lastIndex = 0
    let lm: RegExpExecArray | null
    while ((lm = LXX_PREFIX_RE.exec(text)) !== null) {
      const from = base + lm.index
      const to = from + lm[0].length
      if (!parseRef(lm[0].replace(/^(?:lxx|LXX):/i, ''))) continue
      if (shouldSkip(from, to)) continue
      lxxRanges.push({ from, to })
      decorations.push(Decoration.inline(from, to, { class: 'pm-lxx-ref', 'data-ref': lm[0] }))
    }

    for (const ma of findVerseRefMatches(text)) {
      const from = base + ma.index
      const to = from + ma.length
      const skipped = shouldSkip(from, to)
      const lxxOverlap = lxxRanges.some((r) => r.from < to && r.to > from)
      if (skipped) continue
      if (lxxOverlap) continue
      decorations.push(
        Decoration.inline(from, to, {
          class: ma.lxx ? 'pm-lxx-ref' : 'pm-verse-ref',
          'data-ref': ma.refText,
          'data-lxx': ma.lxx ? 'true' : 'false',
        }),
      )
    }

    LEXICON_REF_RE.lastIndex = 0
    while ((lm = LEXICON_REF_RE.exec(text)) !== null) {
      const from = base + lm.index
      const to = from + lm[0].length
      if (shouldSkip(from, to)) continue
      decorations.push(Decoration.inline(from, to, { class: 'pm-lexicon-ref', 'data-strongs-id': lm[0].toUpperCase() }))
    }

    TAG_REF_RE.lastIndex = 0
    while ((lm = TAG_REF_RE.exec(text)) !== null) {
      const name = lm[1]
      const hashOffset = lm[0].indexOf('#')
      const from = base + lm.index + hashOffset
      const to = from + 1 + name.length
      if (shouldSkip(from, to)) continue
      decorations.push(Decoration.inline(from, to, { class: 'pm-tag-ref', 'data-tag': name }))
    }

    return false
  })

  return DecorationSet.create(doc, decorations)
}

export interface RefClickCallbacks {
  onWikilinkClick?: (title: string) => void
  onVerseRefClick?: (ref: ParsedRef & { forcedTranslation?: string }) => void
  onLexiconRefClick?: (strongsId: string) => void
  /** Right-click on an auto-linked verse reference (plain, LXX, or a verse block's
   *  own reference line) — (x, y) are the native MouseEvent's clientX/clientY. */
  onVerseRefContextMenu?: (ref: ParsedRef & { forcedTranslation?: string }, x: number, y: number) => void
  /** Right-click on an auto-linked Strong's number (plain or a lexicon block's own
   *  reference line). */
  onLexiconRefContextMenu?: (strongsId: string, x: number, y: number) => void
  // Port of NoteEditor.tsx's 350ms hover-delay wikilink preview card
  // (NoteEditor.tsx:4457-4478). The popup itself is rendered by the
  // consumer (same pattern as the block-suggest popups in Phase 4) — this
  // plugin only reports title + anchor rect once the delay elapses, and
  // fires the "hide" callback on mouseleave.
  onWikilinkHoverStart?: (title: string, rect: DOMRect) => void
  onWikilinkHoverEnd?: () => void
  // Same 350ms-delay/anchor-rect pattern as the wikilink hover above, extended to verse and
  // Strong's references — previously the ONE inconsistency between how wikilinks and verse/
  // Strong's refs behaved in a note (wikilinks got a hover preview, verse/Strong's refs didn't,
  // despite otherwise matching visual/click treatment). `onRefHoverEnd` is shared across all
  // hover-preview kinds (wikilink included) rather than each kind getting its own "end" callback
  // — only ever one preview is showing at a time, so there's nothing kind-specific to know on
  // dismiss.
  onVerseRefHoverStart?: (ref: ParsedRef & { forcedTranslation?: string }, rect: DOMRect) => void
  onLexiconRefHoverStart?: (strongsId: string, rect: DOMRect) => void
  onRefHoverEnd?: () => void
  /** Click / 350ms-hover on an inline "#tag" reference. */
  onTagRefClick?: (name: string) => void
  onTagRefHoverStart?: (name: string, rect: DOMRect) => void
}

export const refDecorationsKey = new PluginKey('berean-ref-decorations')

// Verse/lxx/lexicon references are NOT schema nodes or marks (see schema.ts) —
// they're computed live from plain text via regex, exactly mirroring the CM6
// architecture's Decoration.mark-over-flat-text approach. This plugin
// recomputes decorations on every doc change by walking text nodes.
export function createRefDecorationsPlugin() {
  return new Plugin({
    key: refDecorationsKey,
    state: {
      init(_, state) {
        return buildDecorations(state)
      },
      apply(tr, old, _oldState, newState) {
        // Recompute on doc changes AND on suppress-range toggles (the
        // suppress plugin's own state is unaffected by non-docChanged
        // transactions like ⌘⇧R's meta-only dispatch, so check its meta
        // directly rather than only reacting to tr.docChanged).
        if (!tr.docChanged && !tr.getMeta(suppressRangesKey)) return old.map(tr.mapping, tr.doc)
        return buildDecorations(newState)
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}

function buildDecorations(state: EditorState): DecorationSet {
  const isSuppressed = (from: number, to: number) => {
    const ranges = suppressRangesKey.getState(state) ?? []
    return ranges.some((r) => r.from < to && r.to > from)
  }
  // Read blockDecorations.ts's own already-cached DecorationSet (kept up to date by ITS OWN
  // docChanged-gated apply()) instead of recomputing the same full-document block-detection walk
  // here too. Only correct because createBlockDecorationsPlugin is registered BEFORE this plugin
  // in NoteEditorPM.tsx's plugins array — ProseMirror computes each plugin's new state in array
  // order for a given transaction, so by the time THIS plugin's apply() runs, blockDecorations'
  // state has already been updated for the CURRENT transaction, not left one transaction stale.
  const cachedBlockSet = blockDecorationsKey.getState(state) as DecorationSet | undefined
  return buildRefDecorationsForDoc(state.doc, isSuppressed, cachedBlockSet)
}

// Separate plugin (not decoration-producing) purely for click dispatch, so
// it can be constructed per-editor-instance with fresh callback closures
// without needing to rebuild the (potentially expensive) decoration plugin
// itself. DOM-class-based `closest()` dispatch mirrors NoteEditor.tsx's
// onMouseDownCapture handler (lines ~4522-4567) almost verbatim — PM (like
// CM6) renders real DOM, so the same technique applies unchanged.
//
// Deliberately implemented via `handleDOMEvents.click` rather than the more
// obvious-looking `handleClick(view, pos, event)` prop: PM's internal
// dispatch resolves `pos` via `posAtCoords` BEFORE calling `handleClick`,
// and skips calling it entirely if that resolution fails (confirmed in
// prosemirror-view's dispatchEvent/handleSingleClick source) — which our
// dispatch doesn't even need, since it identifies targets purely by DOM
// class. `handleDOMEvents.click` runs unconditionally as the first stage of
// event dispatch, with no such gate.
export function createRefClickPlugin(callbacks: RefClickCallbacks) {
  let hoverTimer: ReturnType<typeof setTimeout> | null = null
  const clearHoverTimer = () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
  }

  return new Plugin({
    props: {
      handleDOMEvents: {
        mouseover(_view, event) {
          const target = event.target as HTMLElement

          const wikiEl = target.closest('.pm-wikilink') as HTMLElement | null
          if (wikiEl) {
            clearHoverTimer()
            hoverTimer = setTimeout(() => {
              callbacks.onWikilinkHoverStart?.(wikiEl.textContent?.trim() ?? '', wikiEl.getBoundingClientRect())
            }, 350)
            return false
          }

          // Verse/lxx refs (plain or a block's own reference line) — same delay, same rect-
          // anchored callback shape as the wikilink case above, just resolving a ParsedRef
          // instead of a note title. A comma-grouped ref ("Deuteronomy 32:3,6,9-13") parses
          // into `parsed.verseGroups` (>1 entry) — that rides along on the ParsedRef handed
          // to onVerseRefHoverStart, so the hover card can iterate each group's verse text;
          // a single ref has no verseGroups and the card renders exactly as before.
          const verseEl = target.closest('.pm-verse-ref, .pm-lxx-ref, .pm-verse-block-ref') as HTMLElement | null
          if (verseEl) {
            clearHoverTimer()
            hoverTimer = setTimeout(() => {
              const raw = (verseEl.getAttribute('data-ref') || verseEl.textContent || '').trim()
              const isLxx = verseEl.getAttribute('data-lxx') === 'true' || verseEl.classList.contains('pm-lxx-ref')
              const bare = isLxx ? raw.replace(/^(?:lxx|LXX):/i, '').replace(/\s+LXX$/i, '').trim() : raw
              const parsed = parseRef(bare)
              if (parsed) callbacks.onVerseRefHoverStart?.(isLxx ? { ...parsed, forcedTranslation: 'LXX' } : parsed, verseEl.getBoundingClientRect())
            }, 350)
            return false
          }

          const lexEl = target.closest('.pm-lexicon-ref, .pm-lexicon-block-ref') as HTMLElement | null
          if (lexEl) {
            clearHoverTimer()
            hoverTimer = setTimeout(() => {
              const strongsId = (lexEl.getAttribute('data-strongs-id') || lexEl.textContent || '').trim().toUpperCase()
              callbacks.onLexiconRefHoverStart?.(strongsId, lexEl.getBoundingClientRect())
            }, 350)
            return false
          }

          const tagEl = target.closest('.pm-tag-ref') as HTMLElement | null
          if (tagEl) {
            clearHoverTimer()
            hoverTimer = setTimeout(() => {
              const name = (tagEl.getAttribute('data-tag') || tagEl.textContent || '').trim().replace(/^#/, '')
              callbacks.onTagRefHoverStart?.(name, tagEl.getBoundingClientRect())
            }, 350)
            return false
          }

          return false
        },
        mouseout(_view, event) {
          const el = (event.target as HTMLElement).closest(
            '.pm-wikilink, .pm-verse-ref, .pm-lxx-ref, .pm-verse-block-ref, .pm-lexicon-ref, .pm-lexicon-block-ref, .pm-tag-ref',
          )
          if (!el) return false
          clearHoverTimer()
          callbacks.onWikilinkHoverEnd?.()
          callbacks.onRefHoverEnd?.()
          return false
        },
        click(_view, event) {
          const target = event.target as HTMLElement

          const wikiEl = target.closest('.pm-wikilink') as HTMLElement | null
          if (wikiEl) {
            callbacks.onWikilinkClick?.(wikiEl.textContent?.trim() ?? '')
            return true
          }

          const lxxEl = target.closest('.pm-lxx-ref') as HTMLElement | null
          if (lxxEl) {
            const raw = (lxxEl.getAttribute('data-ref') || lxxEl.textContent || '').trim()
            const bare = raw.replace(/^(?:lxx|LXX):/i, '').replace(/\s+LXX$/i, '').trim()
            const parsed = parseRef(bare)
            if (parsed) {
              callbacks.onVerseRefClick?.({ ...parsed, forcedTranslation: 'LXX' })
              return true
            }
          }

          const verseEl = target.closest('.pm-verse-ref') as HTMLElement | null
          if (verseEl) {
            const raw = (verseEl.getAttribute('data-ref') || verseEl.textContent || '').trim()
            const parsed = parseRef(raw)
            if (parsed) {
              callbacks.onVerseRefClick?.(parsed)
              return true
            }
          }

          const lexEl = target.closest('.pm-lexicon-ref') as HTMLElement | null
          if (lexEl) {
            const strongsId = (lexEl.getAttribute('data-strongs-id') || lexEl.textContent || '').trim().toUpperCase()
            callbacks.onLexiconRefClick?.(strongsId)
            return true
          }

          const tagEl = target.closest('.pm-tag-ref') as HTMLElement | null
          if (tagEl) {
            const name = (tagEl.getAttribute('data-tag') || tagEl.textContent || '').trim().replace(/^#/, '')
            if (name) { callbacks.onTagRefClick?.(name); return true }
          }

          // A verse/lexicon BLOCK's own reference line (blockDecorations.ts)
          // — carries the same data-ref/data-lxx/data-strongs-id attrs as
          // the plain pm-verse-ref/pm-lxx-ref/pm-lexicon-ref decorations
          // above (by design, see blockDecorations.ts's DetectedBlock), but
          // is a visually and semantically distinct class (no double-
          // decoration — see refDecorations.ts's buildRefDecorationsForDoc
          // exclusion) so it needs its own click check here too. Without
          // this, a block's reference line looked exactly the same but
          // silently did nothing when clicked.
          const verseBlockRefEl = target.closest('.pm-verse-block-ref') as HTMLElement | null
          if (verseBlockRefEl) {
            const raw = (verseBlockRefEl.getAttribute('data-ref') || verseBlockRefEl.textContent || '').trim()
            const isLxx = verseBlockRefEl.getAttribute('data-lxx') === 'true'
            const parsed = parseRef(raw)
            if (parsed) {
              callbacks.onVerseRefClick?.(isLxx ? { ...parsed, forcedTranslation: 'LXX' } : parsed)
              return true
            }
          }

          const lexBlockRefEl = target.closest('.pm-lexicon-block-ref') as HTMLElement | null
          if (lexBlockRefEl) {
            const strongsId = (lexBlockRefEl.getAttribute('data-strongs-id') || lexBlockRefEl.textContent || '').trim().toUpperCase()
            callbacks.onLexiconRefClick?.(strongsId)
            return true
          }

          return false
        },
        contextmenu(_view, event) {
          const target = event.target as HTMLElement

          const lxxEl = target.closest('.pm-lxx-ref') as HTMLElement | null
          if (lxxEl) {
            const raw = (lxxEl.getAttribute('data-ref') || lxxEl.textContent || '').trim()
            const bare = raw.replace(/^(?:lxx|LXX):/i, '').replace(/\s+LXX$/i, '').trim()
            const parsed = parseRef(bare)
            if (parsed && callbacks.onVerseRefContextMenu) {
              event.preventDefault()
              callbacks.onVerseRefContextMenu({ ...parsed, forcedTranslation: 'LXX' }, event.clientX, event.clientY)
              return true
            }
          }

          const verseEl = target.closest('.pm-verse-ref') as HTMLElement | null
          if (verseEl) {
            const raw = (verseEl.getAttribute('data-ref') || verseEl.textContent || '').trim()
            const parsed = parseRef(raw)
            if (parsed && callbacks.onVerseRefContextMenu) {
              event.preventDefault()
              callbacks.onVerseRefContextMenu(parsed, event.clientX, event.clientY)
              return true
            }
          }

          const lexEl = target.closest('.pm-lexicon-ref') as HTMLElement | null
          if (lexEl) {
            const strongsId = (lexEl.getAttribute('data-strongs-id') || lexEl.textContent || '').trim().toUpperCase()
            if (callbacks.onLexiconRefContextMenu) {
              event.preventDefault()
              callbacks.onLexiconRefContextMenu(strongsId, event.clientX, event.clientY)
              return true
            }
          }

          const verseBlockRefEl = target.closest('.pm-verse-block-ref') as HTMLElement | null
          if (verseBlockRefEl) {
            const raw = (verseBlockRefEl.getAttribute('data-ref') || verseBlockRefEl.textContent || '').trim()
            const isLxx = verseBlockRefEl.getAttribute('data-lxx') === 'true'
            const parsed = parseRef(raw)
            if (parsed && callbacks.onVerseRefContextMenu) {
              event.preventDefault()
              callbacks.onVerseRefContextMenu(isLxx ? { ...parsed, forcedTranslation: 'LXX' } : parsed, event.clientX, event.clientY)
              return true
            }
          }

          const lexBlockRefEl = target.closest('.pm-lexicon-block-ref') as HTMLElement | null
          if (lexBlockRefEl) {
            const strongsId = (lexBlockRefEl.getAttribute('data-strongs-id') || lexBlockRefEl.textContent || '').trim().toUpperCase()
            if (callbacks.onLexiconRefContextMenu) {
              event.preventDefault()
              callbacks.onLexiconRefContextMenu(strongsId, event.clientX, event.clientY)
              return true
            }
          }

          return false
        },
      },
    },
  })
}

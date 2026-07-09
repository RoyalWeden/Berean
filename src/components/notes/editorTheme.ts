import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { HIGHLIGHT_COLOR_IDS, highlightMarkBg, LINK_COLORS } from '@/styles/highlightPalette'

/**
 * CodeMirror 6 theme + syntax-highlighting extensions for the note editor's
 * WYSIWYM live-preview mode. Extracted out of NoteEditor.tsx (originally
 * ~4800 lines) so this ~95-line visual definition can be reviewed and
 * restyled independently of the surrounding editor logic. Colors reference
 * the shared tokens in src/styles/highlightPalette.ts and global.css rather
 * than one-off literals, wherever those tokens exist.
 */

// Notion/Obsidian-style heading scale — bigger deltas between levels than the
// original 1.71/1.43/1.29 progression, so document structure reads at a glance.
export const headingStyle = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.9em',  fontWeight: '800', lineHeight: '1.35', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading2, fontSize: '1.55em', fontWeight: '700', lineHeight: '1.35', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading3, fontSize: '1.3em',  fontWeight: '600', lineHeight: '1.4',  color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading4, fontWeight: '700', color: 'rgb(var(--color-text-primary))' },
  { tag: tags.heading5, fontWeight: '600', fontStyle: 'italic', color: 'rgb(var(--color-text-primary))' },
]))

// Override oneDark's colored markdown tokens — must come after oneDark in extensions array
export const bereanSyntaxOverrides = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, color: 'rgb(var(--color-text-primary))' },
  { tag: [tags.list, tags.meta, tags.quote, tags.name], color: 'rgb(var(--color-text-primary))' },
  { tag: [tags.processingInstruction], color: 'rgb(var(--color-text-secondary))' },
  { tag: [tags.link, tags.url], color: 'rgb(99,102,241)' },
]))

export const bereanTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'inherit', // inherit from the container so per-panel zoom applies
    fontFamily: 'var(--font-body, system-ui, sans-serif)',
    backgroundColor: 'transparent !important',
    color: 'rgb(var(--color-text-primary))',
  },
  '.cm-scroller': { padding: '16px', paddingBottom: '96px', overflowY: 'auto', fontFamily: 'inherit' },
  '.cm-content': { caretColor: 'rgb(var(--color-accent))', padding: '0', lineHeight: '1.625', color: 'rgb(var(--color-text-primary))' },
  '.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0', color: 'rgb(var(--color-text-primary))' },
  '.cm-editor': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(100, 120, 220, 0.05)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--selection-bg) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection-bg) !important' },
  '::selection': { backgroundColor: 'var(--selection-bg) !important' },
  // Live preview line-level markers — font sizes set by headingStyle to avoid double-scaling.
  // marginTop gives headings the generous vertical rhythm Notion/Obsidian use to separate
  // sections; first-child guard avoids a stray gap when a note opens with a heading.
  '.cm-live-h1': { fontWeight: '700', marginTop: '0.5em' },
  '.cm-live-h2': { fontWeight: '700', marginTop: '0.45em' },
  '.cm-live-h3': { fontWeight: '600', marginTop: '0.35em' },
  '.cm-live-h4': { fontWeight: '700', marginTop: '0.3em' },
  '.cm-live-h5': { fontWeight: '600', fontStyle: 'italic', marginTop: '0.3em' },
  '.cm-content > .cm-line:first-child.cm-live-h1, .cm-content > .cm-line:first-child.cm-live-h2, .cm-content > .cm-line:first-child.cm-live-h3, .cm-content > .cm-line:first-child.cm-live-h4, .cm-content > .cm-line:first-child.cm-live-h5': { marginTop: '0' },
  // Force heading spans to use theme color regardless of oneDark syntax highlighting
  '.cm-live-h1 span, .cm-live-h2 span, .cm-live-h3 span, .cm-live-h4 span, .cm-live-h5 span': { color: 'rgb(var(--color-text-primary)) !important' },
  '.cm-live-bold': { fontWeight: 'bold' },
  '.cm-live-italic': { fontStyle: 'italic' },
  '.cm-live-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-live-code': { fontFamily: 'monospace', fontSize: '0.875em', backgroundColor: 'rgb(var(--color-surface-4))', padding: '0 3px', borderRadius: '3px', color: 'rgb(var(--color-text-primary)) !important' },
  '.cm-live-code-block': { backgroundColor: 'rgb(var(--color-surface-4))', fontFamily: 'monospace', fontSize: '0.875em', paddingLeft: '12px', paddingRight: '12px', color: 'rgb(var(--color-text-primary)) !important' },
  // Fence lines (```) — same height/font as code-block, text hidden to avoid layout jumps
  // color on the .cm-line alone is overridden by oneDark's child spans, so target * too
  '.cm-live-code-fence': { backgroundColor: 'rgb(var(--color-surface-4))', fontFamily: 'monospace', fontSize: '0.875em', paddingLeft: '12px', paddingRight: '12px' },
  '.cm-live-code-fence *': { color: 'transparent !important', userSelect: 'none' as const },
  '.cm-code-block-top': { borderRadius: '6px 6px 0 0', paddingTop: '6px' },
  '.cm-code-block-bottom': { borderRadius: '0 0 6px 6px', paddingBottom: '6px' },
  '.cm-code-block-only': { borderRadius: '6px', paddingTop: '6px', paddingBottom: '6px' },
  '.cm-live-list-bullet': { color: 'rgb(var(--color-text-primary))' },
  '.cm-live-highlight': { backgroundColor: 'rgba(234,179,8,0.38)', borderRadius: '2px', padding: '0 1px' },
  ...Object.fromEntries(HIGHLIGHT_COLOR_IDS.map((id) => [
    `.cm-live-hl-${id}`,
    { backgroundColor: highlightMarkBg(id), borderRadius: '2px', padding: '0 1px' }
  ])),
  '.cm-live-align-center': { textAlign: 'center' as const },
  '.cm-live-align-right': { textAlign: 'right' as const },
  '.cm-live-align-justify': { textAlign: 'justify' as const },
  '.cm-live-task-done': { textDecoration: 'line-through', opacity: '0.55' },
  '.cm-live-link': { color: 'rgb(99,102,241)', textDecoration: 'underline', cursor: 'pointer' },
  // Wikilinks read as a Notion/Obsidian-style mention chip (tinted background pill)
  // rather than plain underlined text, so they're visually distinct from regular links.
  '.cm-live-wikilink': {
    color: LINK_COLORS.wikilink,
    backgroundColor: 'rgb(var(--link-wikilink) / 0.12)',
    borderRadius: '4px',
    padding: '0.5px 5px',
    textDecoration: 'none',
    cursor: 'pointer',
  },
  '.cm-live-verse-ref': { color: LINK_COLORS.verseRef, textDecoration: 'underline', cursor: 'pointer', textUnderlineOffset: '2px' },
  '.cm-live-lxx-ref': { color: LINK_COLORS.lxxRef, textDecoration: 'underline', cursor: 'pointer', textUnderlineOffset: '2px' },
  '.cm-live-lexicon-ref': { color: LINK_COLORS.lexiconRef, textDecoration: 'underline', textDecorationStyle: 'dashed', cursor: 'pointer', textUnderlineOffset: '2px' },
  '.cm-live-suppressed': { textDecoration: 'none !important', cursor: 'text' },
  '.cm-live-blockquote': { borderLeft: '2px solid rgb(var(--color-accent))', paddingLeft: '0.75em', color: 'rgb(var(--color-text-secondary)) !important' },
  // Verse block — plain text styled like a scripture quote (decoration only)
  '.cm-live-verse-block': { borderLeft: '3px solid rgb(var(--color-accent))', paddingLeft: '0.75em', backgroundColor: 'rgba(100,116,139,0.06)', color: 'rgb(var(--color-text-secondary))' },
  '.cm-live-verse-block-first': { paddingTop: '3px', borderTopLeftRadius: '4px' },
  '.cm-live-verse-block-last': { paddingBottom: '3px', borderBottomLeftRadius: '4px' },
  '.cm-live-verse-block-ref': { fontWeight: '700', color: 'rgb(var(--color-text-primary)) !important' },
  // Lexicon block — same left-accent treatment as verse blocks, actually using the
  // lexicon-ref color now (previously a hardcoded indigo unrelated to .cm-live-lexicon-ref's
  // green, so a lexicon block and an inline lexicon reference looked like different concepts).
  '.cm-live-lexicon-block': { borderLeft: `3px solid ${LINK_COLORS.lexiconRef}`, paddingLeft: '0.75em', backgroundColor: 'rgb(var(--link-lexicon-ref) / 0.06)', color: 'rgb(var(--color-text-secondary))' },
  '.cm-live-lexicon-block-first': { paddingTop: '3px', borderTopLeftRadius: '4px' },
  '.cm-live-lexicon-block-last': { paddingBottom: '3px', borderBottomLeftRadius: '4px' },
  '.cm-live-lexicon-block-header': { fontWeight: '600', color: 'rgb(var(--color-text-primary)) !important' },
  '.cm-live-lexicon-block-num': { fontFamily: 'monospace', color: `${LINK_COLORS.lexiconRef} !important`, fontWeight: '700' },
  '.cm-live-lexicon-block-def': { paddingLeft: '0.8em', opacity: '0.85' },
  '.cm-live-callout-header': { borderLeft: '3px solid rgba(168,85,247,0.7)', paddingLeft: '0.75em', color: 'rgba(192,132,252,0.9) !important', fontWeight: '600' },
  '.cm-live-underline': { textDecoration: 'underline' },
  // Horizontal rule: draw a centred 1 px line using a background gradient so the
  // divider sits at the vertical mid-point of the line rather than at the bottom.
  '.cm-live-hr-line': {
    background: 'linear-gradient(transparent calc(50% - 0.5px), rgba(100,116,139,0.45) calc(50% - 0.5px), rgba(100,116,139,0.45) calc(50% + 0.5px), transparent calc(50% + 0.5px))',
    lineHeight: '1.6',
  },
  '.cm-live-hr-mark': { color: 'transparent', userSelect: 'none' as const },
  // Heading collapse arrow — font-size and vertical-align set inline per level by CollapseArrowWidget.
  // We deliberately avoid vertical-align:middle here because that aligns to the 14 px PARENT
  // x-height, which sits too low inside a tall heading line box.  Instead the widget uses the
  // same font-size as the heading text so baseline alignment naturally centres both elements.
  '.cm-heading-collapse-arrow': { marginLeft: '5px', cursor: 'pointer', userSelect: 'none' as const, opacity: '0.45' },
  '.cm-heading-collapse-arrow:hover': { opacity: '0.85' },
  // Subtle bottom border drawn below each heading line when "heading divider" setting is on
  '.cm-live-h-divider': { borderBottom: '1px solid rgba(100,116,139,0.15)', paddingBottom: '1px' },
})

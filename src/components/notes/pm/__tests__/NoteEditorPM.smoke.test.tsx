import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'
import { useAppStore } from '@/store'

// Lightweight mount smoke test (no @testing-library dependency in this repo)
// — verifies the EditorView actually constructs in jsdom, renders the parsed
// markdown as real DOM, and that typing produces an onChange call with
// correctly re-serialized markdown. This is the only "does it actually run"
// signal available until Phase 8 wires NoteEditorPM into a real call site.
let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

describe('NoteEditorPM smoke test', () => {
  it('mounts and renders parsed markdown as DOM', () => {
    const el = mount({ content: '# Hello\n\nWorld paragraph.', onChange: () => {} })
    const pmRoot = el.querySelector('.ProseMirror')
    expect(pmRoot).toBeTruthy()
    // 'h1' now renders a collapse-arrow prefix (Phase 5's headingNodeView)
    expect(pmRoot?.querySelector('h1')?.textContent).toBe('▾Hello')
    expect(pmRoot?.textContent).toContain('World paragraph.')
  })

  it('respects mode="view" by making the editor non-editable', () => {
    const el = mount({ content: 'Read only text', onChange: () => {}, mode: 'view' })
    const pmRoot = el.querySelector('.ProseMirror') as HTMLElement
    expect(pmRoot.getAttribute('contenteditable')).toBe('false')
  })

  it('mode="edit" (default) is editable', () => {
    const el = mount({ content: 'Editable text', onChange: () => {} })
    const pmRoot = el.querySelector('.ProseMirror') as HTMLElement
    expect(pmRoot.getAttribute('contenteditable')).not.toBe('false')
  })

  it('decorates verse refs, lxx refs, lexicon refs, and wikilinks; clicks fire the right callback', () => {
    let clickedVerse: unknown = null
    let clickedLexicon: string | null = null
    let clickedWiki: string | null = null

    const el = mount({
      content: 'See Gen 1:1 and lxx:Isaiah 9:12 and H7225 and [[My Note]].',
      onChange: () => {},
      onVerseRefClick: (ref) => { clickedVerse = ref },
      onLexiconRefClick: (id) => { clickedLexicon = id },
      onWikilinkClick: (title) => { clickedWiki = title },
    })

    const verseEl = el.querySelector('.pm-verse-ref') as HTMLElement
    const lxxEl = el.querySelector('.pm-lxx-ref') as HTMLElement
    const lexEl = el.querySelector('.pm-lexicon-ref') as HTMLElement
    const wikiEl = el.querySelector('.pm-wikilink') as HTMLElement
    expect(verseEl).toBeTruthy()
    expect(lxxEl).toBeTruthy()
    expect(lexEl).toBeTruthy()
    expect(wikiEl).toBeTruthy()
    expect(wikiEl.textContent).toBe('My Note')

    act(() => { lexEl.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clickedLexicon).toBe('H7225')

    act(() => { wikiEl.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clickedWiki).toBe('My Note')

    act(() => { verseEl.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(clickedVerse).toBeTruthy()
  })

  // Regression: excluding a verse/lexicon BLOCK's own reference line from
  // the general pm-verse-ref/pm-lxx-ref/pm-lexicon-ref scan (to stop it
  // being double-decorated) accidentally made it unclickable too, since
  // createRefClickPlugin's click handler only recognized those exact
  // classes — not the block's own pm-verse-block-ref/pm-lexicon-block-ref.
  describe('verse/lexicon BLOCK reference lines are clickable (not just plain inline refs)', () => {
    beforeEach(() => { useAppStore.setState({ noteScriptureBlock: true, noteScriptureBlockThreshold: 0 }) })
    afterEach(() => { useAppStore.setState({ noteScriptureBlock: false }) })

    it('clicking a single-line verse block\'s reference fires onVerseRefClick', () => {
      let clicked: unknown = null
      const el = mount({
        content: 'Genesis 1:1 In the beginning God created the heaven and the earth',
        onChange: () => {},
        onVerseRefClick: (ref) => { clicked = ref },
      })
      const refEl = el.querySelector('.pm-verse-block-ref') as HTMLElement
      expect(refEl).toBeTruthy()
      act(() => { refEl.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(clicked).toBeTruthy()
    })

    it('clicking an LXX single-line verse block\'s reference fires onVerseRefClick with forcedTranslation LXX', () => {
      // Single-line verse-block detection (SINGLE_VERSE_LINE_RE) only
      // recognizes the "Book c:v LXX body..." suffix form via
      // splitLeadingLxx — the "lxx:Book c:v" prefix form is a
      // refDecorations.ts-only (plain inline pm-lxx-ref) convention, not a
      // verse-BLOCK one.
      let clicked: unknown = null
      const el = mount({
        content: 'Genesis 1:1 LXX In the beginning God made the heaven and the earth',
        onChange: () => {},
        onVerseRefClick: (ref) => { clicked = ref },
      })
      const refEl = el.querySelector('.pm-verse-block-ref') as HTMLElement
      expect(refEl).toBeTruthy()
      act(() => { refEl.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect((clicked as { forcedTranslation?: string } | null)?.forcedTranslation).toBe('LXX')
    })

    it('clicking a lexicon block\'s reference fires onLexiconRefClick', () => {
      let clicked: string | null = null
      const el = mount({
        content: 'H7225 בְּרֵאשִׁית reshiyth;\nthe first, in place, time, order or rank',
        onChange: () => {},
        onLexiconRefClick: (id) => { clicked = id },
      })
      const refEl = el.querySelector('.pm-lexicon-block-ref') as HTMLElement
      expect(refEl).toBeTruthy()
      act(() => { refEl.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(clicked).toBe('H7225')
    })
  })

  it('renders a callout with the correct icon/label header', () => {
    const el = mount({ content: '> [!WARNING] \n> Heads up', onChange: () => {} })
    const callout = el.querySelector('.pm-callout-warning') as HTMLElement
    expect(callout).toBeTruthy()
    expect(callout.querySelector('.pm-callout-header')?.textContent).toContain('Warning')
    expect(callout.textContent).toContain('Heads up')
  })

  it('renders task checkboxes as real, clickable inputs that toggle checked state', () => {
    let changed: string | null = null
    const el = mount({
      content: '- [ ] todo one\n- [x] done one',
      onChange: (c) => { changed = c },
    })
    const boxes = el.querySelectorAll('.pm-task-item input[type=checkbox]') as NodeListOf<HTMLInputElement>
    expect(boxes.length).toBe(2)
    expect(boxes[0].checked).toBe(false)
    expect(boxes[1].checked).toBe(true)

    act(() => {
      boxes[0].checked = true
      boxes[0].dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(changed).toContain('- [x] todo one')
  })

  it('renders bullet list items with a custom glyph marker (not the browser default)', () => {
    const el = mount({ content: '* alpha\n* beta', onChange: () => {} })
    const markers = el.querySelectorAll('.pm-bullet-marker')
    expect(markers.length).toBe(2)
    expect(markers[0].textContent).toBe('•') // default 'classic' style, depth 0
  })

  it('renders a "-" bullet list as a literal dash, distinct from "*"/"+" glyph lists', () => {
    const el = mount({ content: '- alpha\n- beta', onChange: () => {} })
    const markers = el.querySelectorAll('.pm-bullet-marker')
    expect(markers.length).toBe(2)
    expect(markers[0].textContent).toBe('–')
  })

  it('collapses a heading section when its arrow is clicked', () => {
    const el = mount({ content: '# Section\n\nHidden paragraph.\n\n# Next', onChange: () => {} })
    expect(el.querySelector('.ProseMirror')?.textContent).toContain('Hidden paragraph.')
    const arrow = el.querySelector('.pm-heading-collapse-arrow') as HTMLElement
    expect(arrow.textContent).toBe('▾')
    act(() => { arrow.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(arrow.textContent).toBe('▸')
    const hiddenP = Array.from(el.querySelectorAll('p')).find((p) => p.textContent?.includes('Hidden paragraph.'))
    expect(hiddenP && getComputedStyle(hiddenP).display).toBe('none')
  })

  it('re-rendering with an unchanged content prop does not rebuild the document (no cursor/selection reset)', () => {
    const el = mount({ content: 'Hello world', onChange: () => {} })
    const pmRoot = el.querySelector('.ProseMirror') as HTMLElement
    const firstParagraph = pmRoot.firstElementChild

    // Simulate the exact bug scenario: an async source (e.g. NotesPanel's
    // noteChangeToken-driven refetch effect) re-renders the parent with a
    // `content` prop that's identical to what's already live in the editor.
    // Before the fix, this incorrectly compared against a separately-tracked
    // ref instead of the live document, and could wipe the document.
    act(() => { root!.render(<NoteEditorPM content="Hello world" onChange={() => {}} />) })

    const pmRootAfter = el.querySelector('.ProseMirror') as HTMLElement
    // The DOM node for the paragraph should be the SAME element instance —
    // proof that no full-document replace transaction was dispatched.
    expect(pmRootAfter.firstElementChild).toBe(firstParagraph)
    expect(pmRootAfter.textContent).toBe('Hello world')
  })

  it('renders a GFM table as a real editable <table> with the right cell count', () => {
    const el = mount({
      content: '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
      onChange: () => {},
    })
    const table = el.querySelector('table')
    expect(table).toBeTruthy()
    expect(table?.querySelectorAll('th').length).toBe(2)
    expect(table?.querySelectorAll('td').length).toBe(4)
    expect(table?.textContent).toContain('A')
    expect(table?.textContent).toContain('4')
  })

})

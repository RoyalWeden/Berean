import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'
import { useAppStore } from '@/store'

// Reported bug: opening a note that contains a genuine, matching multi-line verse block
// (e.g. pasted "2 Peter 3:1-2" + its verse text) does NOT get boxed/formatted until the
// user clicks somewhere in the note. blockDecorations.test.ts already covers the REJECT
// path (candidate text that does NOT match the real verse, once async verification
// resolves) but nothing exercises the ACCEPT path end-to-end through the real
// NoteEditorPM/React mount — this is the gap that matches the user's report, since the
// reject and accept paths share the exact same fetch/cache/dispatch machinery and a bug
// specific to one of them (e.g. a threshold/ratio issue that only trips on a genuine
// match) wouldn't be caught by the reject-only coverage.
let container: HTMLDivElement | null = null
let root: Root | null = null
let originalBible: unknown

// Each test uses its own ref so the module-level verseRatioCache/versePending state
// (keyed by ref+candidate text, not reset between tests) can't let one test's resolved
// cache entry mask what the other test is actually meant to exercise.
const REF_LINE = '2 Peter 3:1-2'
const V1 = 'This second epistle, beloved, I now write unto you; in both which I stir up your pure minds by way of remembrance:'
const V2 = 'That ye may be mindful of the words which were spoken before by the holy prophets, and of the commandment of us the apostles of the Lord and Saviour:'

const REF_LINE_2 = '2 Peter 3:3-4'
const V3 = 'Knowing this first, that there shall come in the last days scoffers, walking after their own lusts,'
const V4 = 'And saying, Where is the promise of his coming? for since the fathers fell asleep, all things continue as they were from the beginning of the creation.'

// A third, distinct ref+candidate pair (own cache key) so the "checking" micro-state test
// below observes a genuinely fresh/pending lookup rather than reading a cache entry the
// first test in this file already resolved for the same REF_LINE/V1/V2 combination.
const REF_LINE_3 = '2 Peter 3:5-6'
const V5 = 'For this they willingly are ignorant of, that by the word of God the heavens were of old, and the earth standing out of the water and in the water:'
const V6 = 'Whereby the world that then was, being overflowed with water, perished:'

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

async function flushAsyncVerification() {
  // The fetch + cache-set + onResolved()-triggered refresh dispatch all happen across
  // microtask/macrotask boundaries (queryChapter's Promise resolution) outside of any
  // React state update — flushing them without wrapping in `act()` deliberately mirrors
  // what happens in the real app, where nothing forces a React re-render either; the
  // repaint has to come from ProseMirror's own dispatch alone.
  // First wait past noteTextBlocks.ts's own VERSE_LOOKUP_DEBOUNCE_MS (300ms) — the actual
  // DB round-trip is now debounced (real timers here, not fake ones), so it doesn't even
  // START until that elapses.
  await new Promise((r) => setTimeout(r, 320))
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('verse block: async DB verification accepts a genuine match with no interaction', () => {
  beforeEach(() => {
    useAppStore.getState().setNoteScriptureBlock?.(true)
    originalBible = (window as unknown as { bible?: unknown }).bible
    ;(window as unknown as { bible: { queryChapter: (...a: unknown[]) => Promise<unknown> } }).bible = {
      queryChapter: vi.fn().mockResolvedValue([
        { verse_num: 1, text: V1 },
        { verse_num: 2, text: V2 },
        { verse_num: 3, text: V3 },
        { verse_num: 4, text: V4 },
        { verse_num: 5, text: V5 },
        { verse_num: 6, text: V6 },
      ]),
    }
  })
  afterEach(() => {
    useAppStore.getState().setNoteScriptureBlock?.(false)
    ;(window as unknown as { bible?: unknown }).bible = originalBible
    if (root) act(() => root!.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('opening a note with the block fresh (first mount) boxes it once verification resolves, with zero further interaction', async () => {
    const content = `${REF_LINE}\n\n1 ${V1}\n\n2 ${V2}`
    const el = mount({ noteId: 'note-verse-1', content, onChange: () => {} })

    // Pending verification suppresses the block on the first synchronous pass — this part
    // already matches expected/documented behavior.
    expect(el.querySelector('.pm-verse-block')).toBeNull()

    await flushAsyncVerification()

    expect(el.querySelector('.pm-verse-block')).toBeTruthy()
  })

  // Fluid-feel polish #2.2: while accepted === null (the query is in flight), the
  // reference line should carry the "checking" bridge class instead of sitting fully
  // unstyled — and that class should be gone once verification resolves either way, so it
  // never lingers as a stray leftover state.
  it('shows the "checking" micro-state on the ref line while verification is pending, then clears it once resolved', async () => {
    const content = `${REF_LINE_3}\n\n5 ${V5}\n\n6 ${V6}`
    const el = mount({ noteId: 'note-verse-checking', content, onChange: () => {} })

    expect(el.querySelector('.pm-verse-block-checking')).toBeTruthy()
    expect(el.querySelector('.pm-verse-block')).toBeNull()

    await flushAsyncVerification()

    expect(el.querySelector('.pm-verse-block-checking')).toBeNull()
    expect(el.querySelector('.pm-verse-block')).toBeTruthy()
  })

  it('switching TO a note with the block (the sidebar-click path) boxes it once verification resolves, with zero further interaction', async () => {
    const el = mount({ noteId: 'note-1', content: 'First note, nothing special.', onChange: () => {} })

    const content = `${REF_LINE_2}\n\n3 ${V3}\n\n4 ${V4}`
    act(() => {
      root!.render(<NoteEditorPM noteId="note-verse-2" content={content} onChange={() => {}} />)
    })
    expect(el.querySelector('.pm-verse-block')).toBeNull()

    await flushAsyncVerification()

    expect(el.querySelector('.pm-verse-block')).toBeTruthy()
  })
})

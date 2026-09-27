import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { isInOwnSurface } from './sheetEditingGuards'
import { useAppStore } from '@/store'
import type { VerseActionContext, VerseInteraction } from '@/components/bible/verseInteraction'
import { navigateToVerse } from '@/lib/verseNavigation'
import { toggleVerseInSelection } from '@/lib/verseSelection'
import { useSheets, type SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { safeAreaBottom } from '../primitives/safeArea'
import { StrongsSheet } from '../study/StrongsSheet'
import { VerseActionSheet, VERSE_SHEET_LOW_PX } from '../study/VerseActionSheet'
import { getVerseSheetMode, verseSheetLowPx } from '../study/verseSheetMode'
import { VerseNotesSheet } from '../study/VerseNotesSheet'
import { CrossRefsSheet } from '../study/CrossRefsSheet'
import { TagPickerSheet } from '../study/TagPickerSheet'
import { MultiVerseSheet } from '../study/MultiVerseSheet'
import type { SelectedVerseRef } from '@/store'

export const VERSE_SHEET_ID = 'verse'

/** Scroll the reader so a verse sits above the verse sheet (no-op when it already does). */
export function keepVerseAboveSheet(bookId: string, chapter: number, verse: number, textId?: string): void {
  const sheet = document.querySelector(`[data-sheet-id="${VERSE_SHEET_ID}"]`) as HTMLElement | null
  const t = textId ? `[data-text="${textId}"]` : ''
  const row = document.querySelector(`.mobile-reader-pane:not([aria-hidden="true"]) [data-verse-row]${t}[data-book="${bookId}"][data-chapter="${chapter}"][data-verse="${verse}"], .m-compare [data-verse-row]${t}[data-book="${bookId}"][data-chapter="${chapter}"][data-verse="${verse}"]`) as HTMLElement | null
  if (!sheet || !row) return
  const sheetTop = sheet.getBoundingClientRect().top
  const r = row.getBoundingClientRect()
  const margin = 12
  if (r.bottom <= sheetTop - margin && r.top >= 80) return
  const scroller = row.closest('.mobile-reader-scroll, [data-scroll-root], .m-compare-scroll') as HTMLElement | null
  if (!scroller) return
  const target = r.bottom > sheetTop - margin ? r.bottom - (sheetTop - margin) : r.top - 90
  scroller.scrollBy({ top: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

/**
 * The iPhone reader's verse interaction model — shared by the Scripture reader and the Compare
 * page (TEST-035 / TEST-039 / TEST-040):
 *
 *  • TAP anywhere on a verse → it is ADDED to the tab's selection; tapping a selected verse removes
 *    it (T23-028 — a toggle model, contiguous or not). With one verse the verse sheet shows that
 *    verse's study view; with several the SAME sheet (same height) shows the multi-verse view
 *    (MultiVerseSheet). Deselecting the last verse closes it. Drag-select from verse numbers still
 *    works alongside (the selection bar serves a dragged range while no sheet is open).
 *  • Everything the verse sheet opens — notes, cross references, tags, a Strong's entry — opens
 *    INSIDE the verse sheet with "‹ <verse>" at the top (T23-006), never as a second sheet.
 *  • LONG-PRESS → native iOS text selection (handles). One `selectionchange` listener resolves the
 *    verse that holds the selection (through the rows' registered context builders) and shows the
 *    verse sheet at the LOW position in selection mode, forcing it back down while the user drags
 *    the handles. Clearing the selection (tapping elsewhere) closes that sheet and selects nothing.
 *  • Verse-related sheets (verse, verse notes, cross references) get the low detent; others don't.
 */
export function useVerseSheets(opts: { tabId?: string | null; onNavigated?: () => void } = {}) {
  const sheets = useSheets()
  const { tabId } = opts
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const lowPx = VERSE_SHEET_LOW_PX + safeAreaBottom()
  /** The compact position for the remembered mode (a text selection always uses the brief one). */
  const lowFor = (mode: 'tap' | 'selection') => (mode === 'selection' ? VERSE_SHEET_LOW_PX : verseSheetLowPx(getVerseSheetMode(), VERSE_SHEET_LOW_PX)) + safeAreaBottom()

  const openNoteInNotesSpace = useCallback((noteId: string) => {
    setActiveSpace('notes')
    useAppStore.getState().ensureTab('note')
    requestOpenNote(noteId)
  }, [setActiveSpace, requestOpenNote])
  // A Strong's number tapped in the reader text itself opens its own sheet; from inside the verse
  // sheet it is a sub-view of that sheet (see pushStrongs).
  const openStrongs = useCallback((num: string) => {
    sheets.open({ id: 'strongs', detents: [0.42, 0.92], render: (api) => <StrongsSheet strongsNum={num} api={api} /> })
  }, [sheets])
  const pushStrongs = useCallback((api: SheetApi, num: string) => {
    api.push({ key: `strongs-${num}`, title: num, render: (a) => <StrongsSheet strongsNum={num} api={a} /> })
  }, [])
  const pushVerseNotes = useCallback((api: SheetApi, ctx: VerseActionContext) => {
    api.push({ key: 'notes', title: 'Notes', render: (a) => (
      <VerseNotesSheet verseRef={ctx.verseRef} textId={ctx.textId} label={ctx.label} api={a}
        onOpenNote={openNoteInNotesSpace}
        onNewNote={() => ctx.addVerseNote()} />
    ) })
  }, [openNoteInNotesSpace])
  const pushCrossRefs = useCallback((api: SheetApi, ctx: VerseActionContext) => {
    api.push({ key: 'crossrefs', title: 'Cross references', render: (a) => (
      <CrossRefsSheet bookId={ctx.verse.book_id} chapter={ctx.verse.chapter} verses={[ctx.verse.verse_num]} textId={ctx.textId} label={ctx.label} api={a} />
    ) })
  }, [])
  const pushTagPicker = useCallback((api: SheetApi, ctx: VerseActionContext, scope: 'verse' | 'chapter') => {
    const { ranges, label, kind } = ctx.tagRanges(scope)
    api.push({ key: `tag-${scope}`, title: scope === 'chapter' ? 'Tag chapter' : 'Tag verse', render: (a) => <TagPickerSheet ranges={ranges} label={label} kind={kind} api={a} /> })
  }, [])

  const tabIdRef = useRef(tabId)
  tabIdRef.current = tabId
  const sheetVerseKey = useRef<string | null>(null)
  const forceNonce = useRef(0)

  const openVerseSheet = useCallback((ctx: VerseActionContext, mode: 'tap' | 'selection') => {
    const key = `${ctx.verse.book_id}.${ctx.verse.chapter}.${ctx.verse.verse_num}`
    sheetVerseKey.current = key
    sheets.open({
      id: VERSE_SHEET_ID, lowDetent: lowFor(mode), detents: [0.55, 0.92], initialDetent: 0, undimmedThrough: 1,
      // A text selection always brings the sheet back to the low position so the handles stay usable.
      forceDetent: mode === 'selection' ? { index: 0, nonce: ++forceNonce.current } : undefined,
      onClose: () => {
        sheetVerseKey.current = null
        const tid = tabIdRef.current
        const s = useAppStore.getState()
        const sel = tid ? s.selectedVersesByTab[tid] : undefined
        if (tid && sel?.length === 1 && `${sel[0].bookId}.${sel[0].chapter}.${sel[0].verse}` === key) s.clearVerseSelection(tid)
      },
      rootTitle: ctx.label,
      render: (api) => (
        <VerseActionSheet ctx={ctx} api={api}
          onShowNotes={() => pushVerseNotes(api, ctx)}
          onShowCrossRefs={() => pushCrossRefs(api, ctx)}
          onTag={(scope) => pushTagPicker(api, ctx, scope)}
          onStrongs={(num) => pushStrongs(api, num)}
          onNavigateRef={(r, source) => {
            opts.onNavigated?.()
            navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, origin: { kind: 'cross-ref', source, fromVerse: ctx.verse.verse_num } })
          }} />
      ),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, lowPx, pushVerseNotes, pushCrossRefs, pushTagPicker, openNoteInNotesSpace, pushStrongs])

  /** The same verse sheet, showing the several-verse view (T23-028). Opening with the same id keeps
   *  the sheet's current height. */
  const openMultiVerseSheet = useCallback(() => {
    const tid = tabIdRef.current
    if (!tid) return
    sheetVerseKey.current = null
    sheets.open({
      // The sheet is already open when a second verse is tapped, and keeps its height (SEP27-VERSE-003);
      // opened directly, it starts at the mode's usual compact height.
      id: VERSE_SHEET_ID, lowDetent: lowFor('tap'), keepLowDetent: true, detents: [0.55, 0.92], initialDetent: 0, undimmedThrough: 1,
      rootTitle: 'Verses',
      onClose: () => { useAppStore.getState().clearVerseSelection(tid) },
      render: (api) => <MultiVerseSheet tabId={tid} api={api} onOpenNote={openNoteInNotesSpace} />,
    })
  }, [sheets, lowPx, openNoteInNotesSpace])

  // Row registry for native text selection → verse sheet.
  const registry = useRef(new Map<string, () => VerseActionContext>())
  const registerRow = useCallback((key: string, build: () => VerseActionContext) => {
    registry.current.set(key, build)
    return () => { if (registry.current.get(key) === build) registry.current.delete(key) }
  }, [])
  const selectionSheetOpen = useRef(false)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const dbg = import.meta.env.VITE_E2E_PROBE === '1' ? ((window as unknown as { __verseSheetsDebug?: Record<string, unknown> }).__verseSheetsDebug = { registry: registry.current, steps: [] as string[] }) : null
    const step = (m: string) => { if (dbg) { (dbg.steps as string[]).push(m); if ((dbg.steps as string[]).length > 30) (dbg.steps as string[]).shift() } }
    const onSel = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        const sel = window.getSelection()
        const text = sel?.toString().trim() ?? ''
        // A selection (or caret) inside a sheet or any editable field belongs to that surface — a
        // note being edited in the verse sheet, the sheet's search field. The sheet has been
        // adopted: it is no longer a transient "selection sheet", and a caret there must never
        // close it (that destroyed the note editor mid-typing — NOTES-IOS-002).
        if (isInOwnSurface(sel?.anchorNode)) {
          selectionSheetOpen.current = false
          return
        }
        if (!sel || sel.isCollapsed || !text) {
          // Selection dismissed (tap elsewhere): close the selection sheet, select nothing.
          if (selectionSheetOpen.current) { selectionSheetOpen.current = false; sheets.close(VERSE_SHEET_ID) }
          return
        }
        const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement
        const row = node?.closest?.('.mobile-reader [data-verse-row], .m-compare [data-verse-row]') as HTMLElement | null
        if (!row) { step('no-row'); return }
        const key = `${row.dataset.text}|${row.dataset.book}|${row.dataset.chapter}|${row.dataset.verse}`
        const build = registry.current.get(key)
        if (!build) { step(`no-builder ${key} (${registry.current.size})`); return }
        const ctx = build()
        if (!ctx.selection) { step(`no-ctx-selection ${JSON.stringify((ctx as unknown as { __computed?: unknown }).__computed ?? null)}`); return }
        step(`open ${key}`)
        // A text selection is not a verse selection: clear any tapped-verse selection first.
        const tid = tabIdRef.current
        if (tid) useAppStore.getState().clearVerseSelection(tid)
        selectionSheetOpen.current = true
        openVerseSheet(ctx, 'selection')
      }, 140)
    }
    document.addEventListener('selectionchange', onSel)
    return () => { document.removeEventListener('selectionchange', onSel); if (t) clearTimeout(t) }
  }, [sheets, openVerseSheet])

  const verseInteraction = useMemo<VerseInteraction>(() => ({
    interaction: 'touch',
    registerRow,
    onVerseTap: (ctx) => {
      const tid = tabIdRef.current
      const s = useAppStore.getState()
      const ref = { bookId: ctx.verse.book_id, chapter: ctx.verse.chapter, verse: ctx.verse.verse_num, textId: ctx.textId }
      const cur = tid ? (s.selectedVersesByTab[tid] ?? []) : []
      const sameVerse = (r: SelectedVerseRef) => r.bookId === ref.bookId && r.chapter === ref.chapter && r.verse === ref.verse && (r.textId ?? ref.textId) === ref.textId
      const next = toggleVerseInSelection(cur, ref)
      selectionSheetOpen.current = false
      if (next.length === 0) { if (tid) s.clearVerseSelection(tid); sheets.close(VERSE_SHEET_ID); return }
      void haptic.selection()
      if (tid) s.setVerseSelection(tid, next)
      if (next.length > 1) { openMultiVerseSheet(); return }
      // Back to (or starting with) one verse: its study view. When the remaining verse is not the
      // tapped one, rebuild its context from the row registry.
      const only = next[0]
      const onlyCtx = sameVerse(only) ? ctx : registry.current.get(`${only.textId ?? ref.textId}|${only.bookId}|${only.chapter}|${only.verse}`)?.()
      if (!onlyCtx) { openMultiVerseSheet(); return }
      openVerseSheet(onlyCtx, 'tap')
      // e-Sword-style browsing (TEST-043): with the study pane open (the verse sheet above its low
      // position), keep the tapped verse visible ABOVE the pane so verse → Strong's / cross refs
      // can be read side by side while moving through the chapter.
      requestAnimationFrame(() => requestAnimationFrame(() => keepVerseAboveSheet(onlyCtx.verse.book_id, onlyCtx.verse.chapter, onlyCtx.verse.verse_num, onlyCtx.textId)))
    },
    onRequestActions: (ctx) => { void haptic.medium(); openVerseSheet(ctx, ctx.selection ? 'selection' : 'tap') },
  }), [registerRow, sheets, openVerseSheet, openMultiVerseSheet])

  return { verseInteraction, openStrongs, openNoteInNotesSpace, openVerseSheet }
}

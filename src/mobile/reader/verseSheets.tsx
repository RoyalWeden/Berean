import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import type { VerseActionContext, VerseInteraction } from '@/components/bible/verseInteraction'
import { navigateToVerse } from '@/lib/verseNavigation'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { safeAreaBottom } from '../primitives/safeArea'
import { StrongsSheet } from '../study/StrongsSheet'
import { VerseActionSheet, VERSE_SHEET_LOW_PX } from '../study/VerseActionSheet'
import { VerseNotesSheet } from '../study/VerseNotesSheet'
import { CrossRefsSheet } from '../study/CrossRefsSheet'
import { TagPickerSheet } from '../study/TagPickerSheet'

export const VERSE_SHEET_ID = 'verse'

/**
 * The iPhone reader's verse interaction model — shared by the Scripture reader and the Compare
 * page (TEST-035 / TEST-039 / TEST-040):
 *
 *  • TAP anywhere on a verse → that verse becomes the tab's (single-verse) selection and the verse
 *    sheet opens at its special LOW position. Tapping the same verse again deselects and closes.
 *    Tapping another verse moves the selection; an already-expanded sheet keeps its height.
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

  const openNoteInNotesSpace = useCallback((noteId: string) => {
    setActiveSpace('notes')
    useAppStore.getState().ensureTab('note')
    requestOpenNote(noteId)
  }, [setActiveSpace, requestOpenNote])
  const openStrongs = useCallback((num: string) => {
    sheets.open({ id: 'strongs', detents: [0.42, 0.92], render: (api) => <StrongsSheet strongsNum={num} api={api} /> })
  }, [sheets])
  const openVerseNotes = useCallback((ctx: VerseActionContext) => {
    sheets.open({ id: 'verse-notes', lowDetent: lowPx, detents: [0.5, 0.92], initialDetent: 1, render: (api) => (
      <VerseNotesSheet verseRef={ctx.verseRef} textId={ctx.textId} label={ctx.label} api={api}
        onOpenNote={openNoteInNotesSpace}
        onNewNote={() => { void ctx.addVerseNote().then((id) => { if (id) openNoteInNotesSpace(id) }) }} />
    ) })
  }, [sheets, openNoteInNotesSpace, lowPx])
  const openCrossRefs = useCallback((ctx: VerseActionContext) => {
    sheets.open({ id: 'crossrefs', lowDetent: lowPx, detents: [0.55, 0.92], initialDetent: 1, render: (api) => (
      <CrossRefsSheet bookId={ctx.verse.book_id} chapter={ctx.verse.chapter} verse={ctx.verse.verse_num} textId={ctx.textId} label={ctx.label} api={api} />
    ) })
  }, [sheets, lowPx])
  const openTagPicker = useCallback((ctx: VerseActionContext, scope: 'verse' | 'chapter') => {
    const { ranges, label, kind } = ctx.tagRanges(scope)
    sheets.open({ id: 'tag-picker', detents: [0.6, 0.92], render: (api) => <TagPickerSheet ranges={ranges} label={label} kind={kind} api={api} /> })
  }, [sheets])

  const tabIdRef = useRef(tabId)
  tabIdRef.current = tabId
  const sheetVerseKey = useRef<string | null>(null)
  const forceNonce = useRef(0)

  const openVerseSheet = useCallback((ctx: VerseActionContext, mode: 'tap' | 'selection') => {
    const key = `${ctx.verse.book_id}.${ctx.verse.chapter}.${ctx.verse.verse_num}`
    sheetVerseKey.current = key
    sheets.open({
      id: VERSE_SHEET_ID, lowDetent: lowPx, detents: [0.55, 0.92], initialDetent: 0, undimmedThrough: 1,
      // A text selection always brings the sheet back to the low position so the handles stay usable.
      forceDetent: mode === 'selection' ? { index: 0, nonce: ++forceNonce.current } : undefined,
      onClose: () => {
        sheetVerseKey.current = null
        const tid = tabIdRef.current
        const s = useAppStore.getState()
        const sel = tid ? s.selectedVersesByTab[tid] : undefined
        if (tid && sel?.length === 1 && `${sel[0].bookId}.${sel[0].chapter}.${sel[0].verse}` === key) s.clearVerseSelection(tid)
      },
      render: (api) => (
        <VerseActionSheet ctx={ctx} api={api}
          onShowNotes={() => openVerseNotes(ctx)}
          onShowCrossRefs={() => openCrossRefs(ctx)}
          onTag={(scope) => openTagPicker(ctx, scope)}
          onNoteCreated={openNoteInNotesSpace}
          onStrongs={openStrongs}
          onNavigateRef={(r, source) => {
            opts.onNavigated?.()
            navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, origin: { kind: 'cross-ref', source, fromVerse: ctx.verse.verse_num } })
          }} />
      ),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets, lowPx, openVerseNotes, openCrossRefs, openTagPicker, openNoteInNotesSpace, openStrongs])

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
      const same = cur.length === 1 && cur[0].bookId === ref.bookId && cur[0].chapter === ref.chapter && cur[0].verse === ref.verse
      if (same) { if (tid) s.clearVerseSelection(tid); sheets.close(VERSE_SHEET_ID); return }
      void haptic.selection()
      if (tid) s.setVerseSelection(tid, [ref])
      selectionSheetOpen.current = false
      openVerseSheet(ctx, 'tap')
    },
    onRequestActions: (ctx) => { void haptic.medium(); openVerseSheet(ctx, ctx.selection ? 'selection' : 'tap') },
  }), [registerRow, sheets, openVerseSheet])

  return { verseInteraction, openStrongs, openNoteInNotesSpace, openVerseSheet }
}

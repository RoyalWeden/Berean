import React, { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import type { VerseActionContext, VerseInteraction } from '@/components/bible/verseInteraction'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { StrongsSheet } from '../study/StrongsSheet'
import { VerseActionSheet } from '../study/VerseActionSheet'
import { VerseNotesSheet } from '../study/VerseNotesSheet'
import { CrossRefsSheet } from '../study/CrossRefsSheet'
import { TagPickerSheet } from '../study/TagPickerSheet'

/**
 * The reader's touch interaction model for the Compare page (R088): a verse long-press opens the
 * verse action sheet (highlights, notes, cross-refs, tags, copy, read aloud — VerseRow hands over
 * its own implementations), a Strong's chip opens the Strong's sheet, notes open in the Notes
 * space. Same sheets ReaderPage wires; kept here so ComparePage stays readable.
 */
export function useCompareVerseInteraction() {
  const sheets = useSheets()
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const openNoteInNotesSpace = useCallback((noteId: string) => {
    setActiveSpace('notes')
    useAppStore.getState().ensureTab('note')
    requestOpenNote(noteId)
  }, [setActiveSpace, requestOpenNote])
  const openStrongs = useCallback((num: string) => {
    sheets.open({ id: 'strongs', detents: [0.38, 0.92], render: (api) => <StrongsSheet strongsNum={num} api={api} /> })
  }, [sheets])
  const openVerseNotes = useCallback((ctx: VerseActionContext) => {
    sheets.open({ id: 'verse-notes', detents: [0.5, 0.92], render: (api) => (
      <VerseNotesSheet verseRef={ctx.verseRef} textId={ctx.textId} label={ctx.label} api={api}
        onOpenNote={openNoteInNotesSpace}
        onNewNote={() => { void ctx.addVerseNote().then((id) => { if (id) openNoteInNotesSpace(id) }) }} />
    ) })
  }, [sheets, openNoteInNotesSpace])
  const openCrossRefs = useCallback((ctx: VerseActionContext) => {
    sheets.open({ id: 'crossrefs', detents: [0.55, 0.92], render: (api) => (
      <CrossRefsSheet bookId={ctx.verse.book_id} chapter={ctx.verse.chapter} verse={ctx.verse.verse_num} textId={ctx.textId} label={ctx.label} api={api} />
    ) })
  }, [sheets])
  const openTagPicker = useCallback((ctx: VerseActionContext, scope: 'verse' | 'chapter') => {
    const { ranges, label, kind } = ctx.tagRanges(scope)
    sheets.open({ id: 'tag-picker', detents: [0.6, 0.92], render: (api) => <TagPickerSheet ranges={ranges} label={label} kind={kind} api={api} /> })
  }, [sheets])
  const verseInteraction = useMemo<VerseInteraction>(() => ({
    interaction: 'touch',
    onRequestActions: (ctx) => {
      void haptic.medium()
      sheets.open({ id: 'verse-actions', detents: [0.62, 0.92], render: (api) => (
        <VerseActionSheet ctx={ctx} api={api}
          onShowNotes={() => openVerseNotes(ctx)}
          onShowCrossRefs={() => openCrossRefs(ctx)}
          onTag={(scope) => openTagPicker(ctx, scope)}
          onNoteCreated={openNoteInNotesSpace} />
      ) })
    },
  }), [sheets, openVerseNotes, openCrossRefs, openTagPicker, openNoteInNotesSpace])
  return { verseInteraction, openStrongs, openNoteInNotesSpace }
}

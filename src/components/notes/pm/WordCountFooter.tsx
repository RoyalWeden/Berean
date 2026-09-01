import { useEffect, useRef, useState } from 'react'
import type { EditorView } from 'prosemirror-view'
import { Check } from 'lucide-react'
import { computeWordStats, type WordStats } from '@/lib/wordCount'

// Debounce window for the word-count/reading-time footer — deliberately the same 500ms
// autosave uses (NotesPanel.tsx's handleContentChange/handleTitleChange saveTimer) so the
// footer settles at the same moment the note itself is persisted, rather than adding a second,
// independently-tuned timer for what's conceptually the same "user paused typing" signal.
const WORD_COUNT_DEBOUNCE_MS = 500

// Fluid-feel polish #2.3: how long the "Saved" confirmation stays fully visible before its
// CSS opacity transition (SAVE_FLASH_FADE_MS below) starts fading it out. Long enough to
// register as a real confirmation, short enough to stay quiet/out of the way. Exported so the
// fade-timing test asserts against the real value instead of a hardcoded magic number.
export const SAVE_FLASH_HOLD_MS = 1600
// Drives the indicator's inline `transitionDuration` style directly — keeps this one value the
// single source of truth instead of two numbers kept in sync by hand.
export const SAVE_FLASH_FADE_MS = 500

/**
 * Word count / reading time footer, docked to the bottom-right corner of the editor's own
 * `relative` wrapper (NoteEditorPM.tsx). Split out of Toolbar.tsx so it renders independently
 * of the formatting toolbar — idiom notes hide that toolbar (`hideFormattingToolbar`) but still
 * want the count. Carries the quiet "Saved" autosave confirmation on the same row.
 */
export default function WordCountFooter({ view, lastSavedAt }: { view: EditorView | null; lastSavedAt?: number | null }) {
  // `view` is the live EditorView (already in memory — no markdown round-trip), so the doc's
  // own textBetween() is the source of truth. Debounced on `view.state.doc` identity, same
  // cadence as autosave — but computed IMMEDIATELY the first time this effect sees a given
  // `view` (a switched note/tab), which is a doc-identity change same as any keystroke and
  // otherwise made the count visibly pop in ~500ms later with nothing to debounce against.
  const [wordStats, setWordStats] = useState<WordStats>({ words: 0, minutes: 0, characters: 0 })
  const [statsAreSelection, setStatsAreSelection] = useState(false)
  const prevViewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    if (!view) return
    const compute = () => {
      const { doc, selection } = view.state
      const hasSelection = !selection.empty
      const text = hasSelection
        ? doc.textBetween(selection.from, selection.to, '\n', '\n')
        : doc.textBetween(0, doc.content.size, '\n', '\n')
      setStatsAreSelection(hasSelection)
      setWordStats(computeWordStats(text))
    }
    if (prevViewRef.current !== view) {
      prevViewRef.current = view
      compute()
      return
    }
    const timer = setTimeout(compute, WORD_COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // view.state.selection included so a pure selection change (no doc edit) retriggers this too.
  }, [view, view?.state.doc, view?.state.selection])

  // "Saved" confirmation — shown briefly whenever `lastSavedAt` actually changes (only when
  // NotesPanel's autosave IPC call resolves, never on a raw keystroke). Held fully visible for
  // SAVE_FLASH_HOLD_MS, then `visible` flips false so the CSS opacity transition fades it out;
  // the element stays mounted throughout so the fade is a real transition, not a pop.
  const [saveFlashVisible, setSaveFlashVisible] = useState(false)
  useEffect(() => {
    if (lastSavedAt == null) return
    setSaveFlashVisible(true)
    const timer = setTimeout(() => setSaveFlashVisible(false), SAVE_FLASH_HOLD_MS)
    return () => clearTimeout(timer)
  }, [lastSavedAt])

  return (
    <div className="absolute bottom-2 right-3 z-10 flex items-center gap-2 pointer-events-none select-none">
      {lastSavedAt != null && (
        <span
          className="flex items-center gap-1 text-[11px] text-[rgb(var(--color-text-muted))] transition-opacity ease-out"
          style={{ opacity: saveFlashVisible ? 1 : 0, transitionDuration: `${SAVE_FLASH_FADE_MS}ms` }}
        >
          <Check size={11} strokeWidth={2.5} /> Saved
        </span>
      )}
      <div className="text-[11px] text-[rgb(var(--color-text-muted))]">
        {wordStats.words === 0
          ? (statsAreSelection ? '0 words selected' : '0 words')
          : statsAreSelection
            ? `${wordStats.words} word${wordStats.words === 1 ? '' : 's'} · ${wordStats.characters} char${wordStats.characters === 1 ? '' : 's'} selected`
            : `${wordStats.words} word${wordStats.words === 1 ? '' : 's'} · ${wordStats.characters} char${wordStats.characters === 1 ? '' : 's'} · ${wordStats.minutes} min read`}
      </div>
    </div>
  )
}

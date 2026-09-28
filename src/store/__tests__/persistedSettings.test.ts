import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Regression guard for docs/mobile/implementation-progress.md K1: every user-facing setting that
 * has a setter in the store must also be in the persist `partialize` allow-list, otherwise it
 * silently resets to its default on every restart. Checked statically against the source so a
 * newly added setting can't quietly repeat the bug.
 */
const SRC = readFileSync(resolve(__dirname, '../index.ts'), 'utf8')

const PREVIOUSLY_UNPERSISTED = [
  'printIncludeLinkedNotes', 'defaultNoteEditorMode', 'confirmNoteDelete', 'noteSpellCheck', 'autoCopyOnHighlight',
  'noteHeadingDivider', 'noteBulletStyle', 'showVerseNumbers', 'showRedLetters', 'continuousChapterScroll',
  'continuousDailyScroll', 'crossRefSource',
]

function partializeBlock(): string {
  const start = SRC.indexOf('partialize: (state) => ({')
  const end = SRC.indexOf('\n      })', start)
  return SRC.slice(start, end)
}

describe('store persist allow-list', () => {
  it('persists every setting the audit found silently resetting on restart', () => {
    const block = partializeBlock()
    for (const key of PREVIOUSLY_UNPERSISTED) {
      expect(block, `${key} missing from partialize`).toMatch(new RegExp(`^\\s*${key}: state\\.${key},`, 'm'))
    }
  })

  it('every `setXxx` setter whose field has a primitive default is persisted, except the documented per-window/runtime fields', () => {
    // Fields that are deliberately NOT persisted (runtime-only or per-window, see the comments in
    // src/store/index.ts around partialize and perWindowViewState.ts).
    const INTENTIONALLY_UNPERSISTED = new Set([
      'activeSpace', 'activeTabId', 'panelLayout', 'currentSessionId', 'tabLastAccessed', 'kokoroModelReady',
      'accentColor', 'resourceMode', 'noteFocusModeTabId', 'chapterEchoStrongsNum', 'viewerWindowOpen',
      'settingsOpen', 'settingsSection', 'showImportModal', 'importProgress', 'bgImportProgress', 'eSwordImportProgress',
      'scrollByTab', 'selectedVersesByTab', 'noteChangeToken', 'audioPlayback', 'playbackQueue', 'floatingSearchOpen',
      'reduceTransparency', 'increaseContrast', 'aiLookupOpen', 'trailWindowOpen', 'selectionBarSuppressed',
      // Runtime UI state (audit/notes-store-media-tests.md Lane 1 classifies these EPHEMERAL):
      'findBarQuery', 'findBarWordMode', 'activePanelId', 'windowWidth', 'historyTriggerRect', 'systemAccentColor',
      'savedWorkspaces', 'youtubeIsPlaying', 'aiLookupPanelOpen', 'aiLookupActiveChatId', 'youtubeNoteBack',
      'lexiconNoteBack', 'bibleSearchTabActive', 'verseSelectionMenuOpen', 'viewerBlank', 'viewerPaused',
    ])
    const block = partializeBlock()
    const setters = [...SRC.matchAll(/^\s{6}(set[A-Z]\w*): \((\w+)\) => set\(\{ (\w+): \2 \}\)/gm)]
    expect(setters.length).toBeGreaterThan(20)
    const missing = setters
      .map((m) => m[3])
      .filter((field) => !INTENTIONALLY_UNPERSISTED.has(field))
      .filter((field) => !new RegExp(`^\\s*${field}: state\\.${field},`, 'm').test(block))
    expect(missing, `simple settings with a setter but no partialize entry: ${missing.join(', ')}`).toEqual([])
  })
})

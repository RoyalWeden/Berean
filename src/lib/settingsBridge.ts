import { useAppStore, SCRIPTURE_MARGINS, type ScriptureMargins } from '@/store'
import { UNTITLED_NOTE_NAME_FORMATS, type UntitledNoteNameFormat } from '@/lib/notes/finalizeNote'
import { sanitizeCustomThemes } from '@/lib/customTheme'

/**
 * The settings-table ↔ store mapping (SQLite `settings` rows → store setters, and the reverse
 * debounced write-back). Shared by the desktop App.tsx and the mobile shell so both hydrate and
 * persist exactly the same keys — extracted verbatim from App.tsx's mount effect.
 */
export function hydrateSettingsIntoStore(all: Record<string, unknown>): void {
  const s = useAppStore.getState()
  if (typeof all.theme === 'string' && ['dark', 'light', 'system'].includes(all.theme as string))
    s.setTheme(all.theme as 'dark' | 'light' | 'system')
  if (Array.isArray(all.customThemes)) s.setCustomThemes(sanitizeCustomThemes(all.customThemes))
  if (typeof all.themePreset === 'string') s.setThemePreset(all.themePreset)
  if (typeof all.fontSize === 'number') s.setBibleFontSize(all.fontSize)
  if (typeof all.lineHeight === 'string') s.setBibleLineHeight(all.lineHeight as 'compact' | 'comfortable' | 'spacious')
  if (typeof all.scriptureMargins === 'string' && (SCRIPTURE_MARGINS as readonly string[]).includes(all.scriptureMargins)) s.setScriptureMargins(all.scriptureMargins as ScriptureMargins)
  if (typeof all.untitledNoteNameFormat === 'string' && (UNTITLED_NOTE_NAME_FORMATS as readonly string[]).includes(all.untitledNoteNameFormat)) s.setUntitledNoteNameFormat(all.untitledNoteNameFormat as UntitledNoteNameFormat)
  if (typeof all.defaultTranslation === 'string') s.setDefaultBibleTranslation(all.defaultTranslation)
  if (typeof all.hermasTranslation === 'string') s.setHermasTranslation(all.hermasTranslation)
  if (typeof all.scriptureFontFamily === 'string') s.setScriptureFontFamily(all.scriptureFontFamily)
  if (typeof all.notesFontFamily === 'string') s.setNotesFontFamily(all.notesFontFamily)
  if (typeof all.uiFontFamily === 'string') s.setUiFontFamily(all.uiFontFamily)
  if (typeof all.autoPiP === 'boolean') s.setAutoPiP(all.autoPiP)
  if (typeof all.noteVerseRefsEnabled === 'boolean') s.setNoteVerseRefsEnabled(all.noteVerseRefsEnabled)
  if (typeof all.noteLexiconRefsEnabled === 'boolean') s.setNoteLexiconRefsEnabled(all.noteLexiconRefsEnabled)
  if (typeof all.defaultScriptureLayout === 'string') s.setDefaultScriptureLayout(all.defaultScriptureLayout as import('@/types').ScriptureLayout)
  if (typeof all.noteTransformLayout === 'string') s.setNoteTransformLayout(all.noteTransformLayout as 'right' | 'bottom' | 'left')
  if (typeof all.crossRefSource === 'string') s.setCrossRefSource(all.crossRefSource as 'tske' | 'classic' | 'notes')
  if (typeof all.autoCloseTabsAfter === 'number') s.setAutoCloseTabsAfter(all.autoCloseTabsAfter)
  if (typeof all.wordReplacerEnabled === 'boolean') s.setWordReplacerEnabled(all.wordReplacerEnabled)
  if (typeof all.noteScriptureBlock === 'boolean') s.setNoteScriptureBlock(all.noteScriptureBlock)
  if (typeof all.sidePanelScriptureBlock === 'boolean') s.setSidePanelScriptureBlock(all.sidePanelScriptureBlock)
  if (typeof all.noteScriptureBlockThreshold === 'number') s.setNoteScriptureBlockThreshold(all.noteScriptureBlockThreshold)
  if (typeof all.autoEmDash === 'boolean') s.setAutoEmDash(all.autoEmDash)
}

type S = ReturnType<typeof useAppStore.getState>
const PERSISTED: Array<[settingKey: string, pick: (s: S) => unknown]> = [
  ['theme', (s) => s.theme], ['themePreset', (s) => s.themePreset],
  ['customThemes', (s) => s.customThemes],
  ['fontSize', (s) => s.bibleFontSize], ['lineHeight', (s) => s.bibleLineHeight],
  ['scriptureMargins', (s) => s.scriptureMargins],
  ['untitledNoteNameFormat', (s) => s.untitledNoteNameFormat],
  ['defaultTranslation', (s) => s.defaultBibleTranslation],
  ['hermasTranslation', (s) => s.hermasTranslation],
  ['scriptureFontFamily', (s) => s.scriptureFontFamily],
  ['notesFontFamily', (s) => s.notesFontFamily], ['uiFontFamily', (s) => s.uiFontFamily],
  ['autoPiP', (s) => s.autoPiP],
  ['noteVerseRefsEnabled', (s) => s.noteVerseRefsEnabled],
  ['noteLexiconRefsEnabled', (s) => s.noteLexiconRefsEnabled],
  ['defaultScriptureLayout', (s) => s.defaultScriptureLayout],
  ['noteTransformLayout', (s) => s.noteTransformLayout],
  ['crossRefSource', (s) => s.crossRefSource],
  ['autoCloseTabsAfter', (s) => s.autoCloseTabsAfter],
  ['wordReplacerEnabled', (s) => s.wordReplacerEnabled],
  ['noteScriptureBlock', (s) => s.noteScriptureBlock],
  ['sidePanelScriptureBlock', (s) => s.sidePanelScriptureBlock],
  ['noteScriptureBlockThreshold', (s) => s.noteScriptureBlockThreshold],
  ['autoEmDash', (s) => s.autoEmDash],
]

/**
 * Subscribe to the store and write changed settings to SQLite, debounced, with a pending write
 * flushed on cleanup / `beforeunload` (and on `pagehide` for the WebView, which may be suspended
 * without unloading). Returns the disposer.
 */
export function persistSettingsFromStore(debounceMs = 800): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingFlush: (() => void) | null = null
  const flush = () => {
    if (!pendingFlush) return
    clearTimeout(timer)
    pendingFlush()
    pendingFlush = null
  }
  const unsub = useAppStore.subscribe((state, prev) => {
    if (!PERSISTED.some(([, pick]) => pick(state) !== pick(prev))) return
    clearTimeout(timer)
    const writeNow = () => {
      const s = useAppStore.getState()
      for (const [k, pick] of PERSISTED) window.settings?.set(k, pick(s)).catch(() => {})
      pendingFlush = null
    }
    pendingFlush = writeNow
    timer = setTimeout(writeNow, debounceMs)
  })
  window.addEventListener('beforeunload', flush)
  window.addEventListener('pagehide', flush)
  return () => {
    flush()
    window.removeEventListener('beforeunload', flush)
    window.removeEventListener('pagehide', flush)
    unsub()
  }
}

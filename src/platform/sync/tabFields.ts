import type { Tab, TabState, TabType } from '../../types'

/**
 * Splits a tab's per-type `state` object into the part that synchronises across devices and the
 * part that stays on this device — the classification in docs/mobile/icloud.md §6. Ephemeral
 * fields (navigation targets consumed on arrival) are dropped from both.
 *
 * The split is by explicit allow-lists so a new field added to a tab type is LOCAL until someone
 * decides otherwise (safer default: nothing leaks to other devices by accident).
 */
const SYNC_FIELDS: Record<TabType, readonly string[]> = {
  bible: [
    'bookId', 'chapter', 'endChapter', 'verse', 'translation', 'showStrongs', 'compareMode', 'compareColumns',
    'compareSyncScroll', 'hiddenAnnotations', 'rightPanelTab', 'rightPanelNoteId', 'rightPanelLexiconEntry',
    'rightPanelVerseFilter', 'rightPanelSlotBTabs', 'rightPanelSlotB', 'rightPanelNoteIdB', 'rightPanelLexiconEntryB',
    'rightPanelVerseFilterB', 'searchMode', 'scriptureSearchQuery', 'scriptureLayout', 'searchTextId', 'searchWordMode',
    'searchTestamentFilter', 'searchBookFilter', 'searchSortMode', 'searchTagFilter', 'searchTagFilterAll',
    'noteBack', 'scriptureBack', 'searchBack',
  ],
  note: ['noteId', 'isNew', 'verseRef', 'homeView'],
  lexicon: ['strongsNum', 'searchQuery', 'searchLang', 'lexHistory'],
  youtube: ['videoId', 'playlistId', 'url', 'youtubeLayout', 'panelA', 'panelB'],
  search: ['query'],
  pdf: ['pdfId', 'title', 'page'],
  tags: ['selectedTagId'],
  history: ['category', 'studyOnly'],
  settings: ['section'],
}

const LOCAL_FIELDS: Record<TabType, readonly string[]> = {
  bible: [
    'scrollPosition', 'rightPanelOpen', 'rightPanelWidth', 'bottomPanelHeight', 'rightPanelNoteCursor',
    'rightPanelNoteFocused', 'rightPanelExpandAll', 'rightPanelExpandAllB', 'rightPanelScrollTop', 'rightPanelScrollTopB',
    'rightPanelScrollTops', 'rightPanelScrollTopsB',
    'rightPanelNoteCursorB', 'rightPanelNoteFocusedB', 'searchScrollTop', 'searchScrollAnchor',
  ],
  note: ['scrollTop', 'cursorPos', 'listScrollTop', 'continuousDailyDate'],
  lexicon: ['scrollTop', 'searchScrollTop'],
  youtube: ['scrollTop'],
  search: ['scrollTop', 'results', 'scope', 'filters', 'preview'],
  pdf: ['scrollTop'],
  tags: [],
  history: [],
  settings: [],
}

/** Nested keys inside otherwise-synced objects that are device presentation. */
const NESTED_LOCAL: Record<TabType, Record<string, readonly string[]>> = {
  bible: { compareColumns: ['scrollPos'] },
  note: { homeView: ['previewNoteId', 'previewFolderId'] },
  lexicon: {}, youtube: {}, search: {}, pdf: {}, tags: {}, history: {}, settings: {},
}

export interface SplitTabState { sync: Record<string, unknown>; local: Record<string, unknown> }

export function splitTabState(type: TabType, state: TabState): SplitTabState {
  const src = state as unknown as Record<string, unknown>
  const sync: Record<string, unknown> = {}
  const local: Record<string, unknown> = {}
  for (const k of SYNC_FIELDS[type] ?? []) {
    if (src[k] === undefined) continue
    let v = src[k]
    const nestedLocal = NESTED_LOCAL[type]?.[k]
    if (nestedLocal && v !== null && typeof v === 'object') {
      if (Array.isArray(v)) {
        const stripped = v.map((item) => {
          if (item && typeof item === 'object') {
            const copy = { ...(item as Record<string, unknown>) }
            const localPart: Record<string, unknown> = {}
            for (const nk of nestedLocal) if (nk in copy) { localPart[nk] = copy[nk]; delete copy[nk] }
            return { copy, localPart }
          }
          return { copy: item, localPart: {} }
        })
        v = stripped.map((s) => s.copy)
        // Only when some column actually carries a local part — an array of empty shells is noise
        // (and, merged with a spread, once wiped the synced columns).
        if (stripped.some((s) => Object.keys(s.localPart).length)) local[k] = stripped.map((s) => s.localPart)
      } else {
        const copy = { ...(v as Record<string, unknown>) }
        const localPart: Record<string, unknown> = {}
        for (const nk of nestedLocal) if (nk in copy) { localPart[nk] = copy[nk]; delete copy[nk] }
        v = copy
        if (Object.keys(localPart).length) local[k] = localPart
      }
    }
    sync[k] = v
  }
  for (const k of LOCAL_FIELDS[type] ?? []) {
    if (src[k] !== undefined) local[k] = src[k]
  }
  return { sync, local }
}

/** Inverse of splitTabState: re-assembles one `state` object for the store. */
export function mergeTabState(type: TabType, sync: Record<string, unknown>, local: Record<string, unknown>): TabState {
  const out: Record<string, unknown> = { ...sync }
  for (const [k, v] of Object.entries(local)) {
    const nestedLocal = NESTED_LOCAL[type]?.[k]
    if (nestedLocal && k in out && v !== null && typeof v === 'object') {
      const base = out[k]
      if (Array.isArray(base) && Array.isArray(v)) {
        out[k] = base.map((item, i) => (item && typeof item === 'object' && v[i] && typeof v[i] === 'object' ? { ...(item as object), ...(v[i] as object) } : item))
      } else if (base && typeof base === 'object' && !Array.isArray(base)) {
        out[k] = { ...(base as object), ...(v as object) }
      }
      continue
    }
    out[k] = v
  }
  return out as unknown as TabState
}

/** Stable JSON for change detection (keys sorted, undefined dropped). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, key) => {
        const x = (v as Record<string, unknown>)[key]
        if (x !== undefined) acc[key] = x
        return acc
      }, {})
    }
    return v
  })
}

export function isKnownTabType(t: string): t is TabType {
  return t in SYNC_FIELDS
}

/** Everything about a Tab except its state, as stored in the `tabs` table. */
export function tabMeta(tab: Tab) {
  return { id: tab.id, spaceId: tab.spaceId, type: tab.type, title: tab.title, isPinned: !!tab.isPinned, originTabId: tab.originTabId ?? null, originSpaceId: tab.originSpaceId ?? null }
}

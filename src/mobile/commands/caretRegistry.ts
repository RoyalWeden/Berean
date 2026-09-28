import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { SheetApi } from '../primitives/Sheet'

/**
 * The caret's command registry (TEST-033 / brief §28–30). The upward caret in the bottom
 * navigation shows commands RELEVANT TO WHAT IS ON SCREEN — never one global list.
 *
 * Each page registers its own commands while it is mounted (`useCaretCommands`); the most
 * recently registered, still-mounted scope wins, so a pushed page (note editor over the notes
 * list, a settings sub-page) naturally takes over and hands back on pop. Pages without their own
 * registration fall back to a static provider for their tab type (staticCommands.tsx). No page
 * needs to know about any other page's commands, and no component branches on tab type.
 */
/** What a `view` command shows inside the same caret sheet: a nested command scope (rendered by
 *  CaretSheet itself) or a custom body. The caret then shows "‹ <parent title>" at its top. */
export type CaretView =
  | { title: string; scope: () => CaretScope }
  | { title: string; render: (api: SheetApi) => ReactNode }

export type CaretCommand =
  | { kind: 'action'; id: string; label: string; icon?: LucideIcon; detail?: string; value?: string; destructive?: boolean; disabled?: boolean; keepOpen?: boolean; /** Spoken label when the visible one is terse (e.g. "LXX"). */ a11yLabel?: string; run: () => void; /** A long press on the tile / row (e.g. Today → the calendar, SEP27-CAL-006). */ longPress?: () => void }
  /** Opens a sub-view in the same sheet (T23-006/019); `value` is shown at the right ("KJV ›"). */
  | { kind: 'view'; id: string; label: string; icon?: LucideIcon; detail?: string; value?: string; disabled?: boolean; view: () => CaretView }
  | { kind: 'toggle'; id: string; label: string; icon?: LucideIcon; detail?: string; value: boolean; set: (v: boolean) => void }
  | { kind: 'stepper'; id: string; label: string; icon?: LucideIcon; value: number; unit?: string; min: number; max: number; set: (v: number) => void }
  | { kind: 'segmented'; id: string; label: string; icon?: LucideIcon; value: string; options: Array<[string, string]>; set: (v: string) => void }
  /** Inline content rendered in the sheet's own scroll (no nested scroller) — e.g. the Cross References
   *  cards inside a collapsible section (XREF-003). `render` receives the sheet so it can close it. */
  | { kind: 'content'; id: string; label: string; icon?: LucideIcon; render: (api: SheetApi) => React.ReactNode }

export interface CaretSection {
  id: string
  title?: string
  /** `tiles` — the few most frequent actions as large tiles at the top (Arc-style); `rows` — a grouped list. */
  style?: 'tiles' | 'rows'
  /** A compact one-line row that expands INLINE (in this same sheet) into the section's commands
   *  — e.g. "Display ›" (SEP24-010). Collapsed by default. */
  collapsible?: { label: string; icon?: LucideIcon; summary?: string }
  commands: CaretCommand[]
}

export interface CaretScope {
  /** What the caret is acting on, shown as its heading ("Genesis 1", "Notes", …). */
  title: string
  subtitle?: string
  /** Name of this context for the back control of views pushed from it ("‹ Scripture").
   *  Defaults to `title`. */
  backTitle?: string
  /** The navigation header (SEP24-008): the current location as a search-field-like control
   *  (tap → a view in this sheet to go somewhere else) with the CURRENT TAB's back / forward
   *  history (the shared per-tab nav stack — navTabBack / navTabForward). */
  location?: { label: string; placeholder?: string; view?: () => CaretView; /** Instead of a view: close the caret and run (e.g. focus the page's own search field). */ run?: () => void }
  sections: CaretSection[]
}

type Entry = { token: number; scope: () => CaretScope }
let entries: Entry[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

export const caretRegistry = {
  register(scope: () => CaretScope): () => void {
    const e: Entry = { token: ++seq, scope }
    entries = [...entries, e]
    emit()
    return () => { entries = entries.filter((x) => x !== e); emit() }
  },
  /** The top scope's builder (null → use the static provider for the active tab type). */
  top(): (() => CaretScope) | null { return entries.length ? entries[entries.length - 1].scope : null },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  version(): number { return entries.length ? entries[entries.length - 1].token : 0 },
  /** Test helper. */
  reset() { entries = []; emit() },
}

/** Register this page's caret commands while mounted. `build` is read lazily when the caret opens,
 *  so it always reflects current state without re-registering on every render. */
export function useCaretCommands(build: () => CaretScope, enabled = true): void {
  const ref = useRef(build)
  ref.current = build
  useEffect(() => {
    if (!enabled) return
    return caretRegistry.register(() => ref.current())
  }, [enabled])
}

/** Re-renders when the top registration changes (a page pushed/popped). */
export function useCaretTopVersion(): number {
  return useSyncExternalStore(caretRegistry.subscribe, caretRegistry.version, caretRegistry.version)
}

/** Reuse a page's existing action-sheet definitions as caret commands (no re-implementation):
 *  ids listed in `tiles` become the top tile row, the rest a grouped list. */
export function fromSheetActions(
  actions: Array<{ id: string; label: string; icon?: LucideIcon; destructive?: boolean; disabled?: boolean; value?: string; onSelect: () => void; view?: () => CaretView }>,
  opts: { tiles?: string[]; title?: string; tileLabels?: Record<string, string> } = {},
): CaretSection[] {
  // An action with a `view` opens inside the caret (T23-006) instead of closing it for a new sheet.
  const toCmd = (a: (typeof actions)[number], label = a.label): CaretCommand => (a.view
    ? { kind: 'view', id: a.id, label, icon: a.icon, disabled: a.disabled, value: a.value, view: a.view }
    : { kind: 'action', id: a.id, label, icon: a.icon, destructive: a.destructive, disabled: a.disabled, value: a.value, run: a.onSelect })
  const tiles = actions.filter((a) => opts.tiles?.includes(a.id)).map((a) => toCmd(a, opts.tileLabels?.[a.id] ?? a.label))
  const rows = actions.filter((a) => !opts.tiles?.includes(a.id)).map((a) => toCmd(a))
  return [
    ...(tiles.length ? [{ id: 'tiles', style: 'tiles' as const, commands: tiles }] : []),
    ...(rows.length ? [{ id: 'rows', title: opts.title, commands: rows }] : []),
  ]
}

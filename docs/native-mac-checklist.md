# Berean — Native Mac Feel & Performance Checklist

> Living status doc. This is the source of truth for the `native-mac-audit` skill
> (`.claude/skills/native-mac-audit/SKILL.md`) — update checkboxes here as items land
> so the skill and this doc never drift apart. Don't duplicate this checklist elsewhere.

Originally seeded from a chat reviewing a Sept 2026 screenshot of the app. Re-verified
against the actual codebase on 2026-09-12 — most of the original brief turned out to
already be implemented. Items below reflect real state, not the original assumptions.

---

## Already implemented (verified 2026-09-12)

- [x] **Vibrancy** — `vibrancy: 'sidebar'`, `transparent: true` on the main `BrowserWindow`
      (`electron/main.ts:779`), `titleBarStyle: 'hiddenInset'` on mac (`electron/main.ts:769`)
- [x] **System accent color** — `systemPreferences.getAccentColor()` wired end-to-end:
      `safeGetAccentColor()` (`electron/main.ts:25`) → IPC `app:getAccentColor` (`:1489`) →
      preload (`electron/preload.ts:274-275`) → `App.tsx:550-554` → `src/lib/applyTheme.ts:61-62`
      (sets `--color-accent`). Live-updates via `systemPreferences.on('accent-color-changed', …)`
      (`electron/main.ts:1626`)
- [x] **Selection highlight** — uses theme rgba var `--selection-bg`, not a hardcoded blue
- [x] **Scrollbars** — thin, transparent track, auto-hide-on-scroll (not hover) already built:
      `src/styles/global.css:1301-1323`, `src/lib/scrollbarAutoHide.ts`
- [x] **Edit menu** — `cut`/`copy`/`paste`/`selectAll`/`undo`/`redo` roles present
      (`electron/main.ts:369-377`), so ⌘C/⌘V work in text fields
- [x] **Window state persistence** — custom SQLite-backed bounds save/restore (not
      `electron-window-state`, but functionally equivalent), debounced live-save on
      resize/move, maximize/unmaximize handled (`electron/main.ts:472-553`, `:845-847`)
- [x] **Zoom** — ⌘+ / ⌘− / ⌘0 wired (`src/App.tsx:865-870`)
- [x] **Two-finger swipe chapter nav** — `src/components/bible/useChapterPullNav.ts`,
      wired in `BiblePanel.tsx:1369`
- [x] **Notes & cross-refs storage** — already `better-sqlite3` (`electron/db/berean.ts`),
      not JSON; JSON is only used for the separate vault export/sync feature
- [x] **Chapter output caching** — `src/lib/chapterCache.ts`, consumed in `ChapterView.tsx`
- [x] **Code-splitting** — `React.lazy` already covers AI Lookup, Settings, History,
      Import, Onboarding, Tasks (`App.tsx:38-46`), YouTube + TagsGraph
      (`ActivePanel.tsx:16-21`, `FloatingShell.tsx:19`)
- [x] **Electron hygiene** — `contextIsolation: true`, `nodeIntegration: false`, scoped
      `contextBridge` preload on every window type; no `ipcRenderer.sendSync` anywhere

## Open — Phase 1: Native Mac feel

- [ ] **Panel translucency** — sidebar/right-panel backgrounds use opaque theme surface
      vars (`bg-[rgb(var(--color-surface-1))]` etc. in `Sidebar.tsx`, `BibleRightPanel.tsx`).
      Window-level vibrancy has nothing to blur through on these specific panels. Needs a
      decision on how translucent (full color-mix like `AiLookupPanel.tsx:20-21` uses, or
      something lighter) — **not yet decided, discuss before implementing**
- [ ] **Hardcoded-blue cleanup** — spots bypassing the theme-var system:
  - `src/components/bible/VerseRow.tsx:1776` — LXX cross-reference source badge
  - `src/components/notes/NoteBadgeRow.tsx:65` — note verse-ref pill (closest thing to a
    "note indicator" still using hardcoded blue)
  - `src/components/settings/ESwordImporter.tsx:283` — note-type badge
  - `src/lib/notePreviewRender.ts:695` — hardcoded `#3b82f6` verse border
- [ ] **File / Help menus** — currently only Berean (mac)/Edit/View(dev-only)/Window
      exist (`electron/main.ts:336-427`). No File menu, no Help menu.
- [ ] **⌘[ / ⌘] accelerators** — `prevChapter`/`nextChapter`/`navBack`/`navForward`
      actions already exist and are reachable via command palette / mouse buttons
      (`ShellHeader.tsx:345,364,547-548`), but no keyboard accelerator is wired
- [ ] **AI Lookup floating panel vs. native popover** — already has blur/shadow/resize
      (`src/components/ailookup/AiLookupPanel.tsx`); default anchor position and
      dismiss-on-click-away behavior not yet confirmed against "native popover" feel
- [ ] **Toolbar icon hover/press states** — ~6px-radius hover background and press
      feedback not yet verified across toolbar icons (chevrons, tag, sidebar toggle, info)
- [ ] **Dark mode / vibrancy adaptation** — confirm `nativeTheme.shouldUseDarkColors` /
      `prefers-color-scheme` path adapts vibrancy and traffic lights automatically
      (not yet explicitly re-verified in this pass)

## Open — Phase 2: Performance

- [ ] **Verse list virtualization** — not implemented; no `react-window`/`react-virtuoso`
      usage found anywhere in `src`. Psalm 119 (176 verses) is the real stress case.
- [ ] **Strong's / cross-ref lookups off main thread** — not confirmed either way; needs
      investigation before deciding whether a Web Worker or IPC-with-caching is warranted
- [ ] **Lexicon / Cross-Ref panel lazy-loading by name** — YouTube and TagsGraph are
      confirmed lazy (`React.lazy`); Lexicon and Cross-Ref panels weren't found under
      those names in the lazy-load list — needs a follow-up check on whether they're
      already covered under a different component name or genuinely eager-loaded

## Decision log

_(Record settled calls here as Phase 1/2 items are discussed and implemented, so future
sessions don't re-litigate them — e.g. "we deliberately kept serif type for scripture
body — don't flag as non-native.")_

- 2026-09-12: Checklist doc rewritten against actual codebase state before any Phase 1
  code changes; original brief was significantly stale (most "unconfirmed" items were
  already done). See `feature/native-audit-skill` branch.

---

## How this doc is used

- The `native-mac-audit` skill (broad-triggers on "make this feel more native", "polish
  the UI", etc.) reads this file's unchecked items as its working checklist rather than
  embedding its own copy.
- Update checkboxes here as items land — this is a living status doc, not a one-time
  prompt.
- Phase 1 items are worked one at a time, each discussed before implementation, per
  project convention.

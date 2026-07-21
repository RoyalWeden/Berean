# Follow-up punch list: more memory savings + native-feel unification

Research deliverable, not implementation — produced by a three-agent team (memory auditor,
native-feel designer, feasibility reviewer) as a round-2 follow-up to the performance pass and
Shell Seam Study already shipped on `feature/ui-polish-july`. Nothing here has been built yet;
pick what to act on next the same way the seam-study brainstorm led into its own follow-up round.

Verdicts: **CLEAR** (feasible, low risk) · **NEEDS TWEAK** (feasible, one correction/scoping note
below) · **RISKY** (real risk or the premise doesn't hold as stated — read the note before doing this).

## Memory

### 1. Narrow `activeTabId` subscriptions — CLEAR, with two corrections
Same shape as the already-shipped `tabs` narrowing (11 components → 7 narrowed to their own
space). `activeTabId: Record<SpaceId, string|null>` has the identical whole-object fan-out risk.

- `BiblePanel.tsx:47` → `useAppStore(s => s.activeTabId.scripture)`
- `NotesPanel.tsx:53` → `s.activeTabId.notes`
- `LexiconPanel.tsx:884` → `s.activeTabId.lexicon`
- `PDFViewer.tsx:37` → `s.activeTabId.scripture`
- `SearchTab.tsx:97` → narrow the reactive read (line 105, `['search']`) to `s.activeTabId.search`;
  the *separate* `['scripture']` read (line 232) is inside a callback — move that one to
  `useAppStore.getState()` instead of subscribing.
- `FloatingSearch.tsx:152` → drop the subscription entirely; its one use (line 472) is inside a
  callback, so `useAppStore.getState().activeTabId` there is enough.
- `ShellHeader.tsx:41` → `useAppStore(s => s.activeTabId[s.activeSpace])` — a scalar selector
  reading a dynamic key, correct for both of its use sites (lines 42, 61).

**Correction from feasibility review:** the initial framing called FloatingSearch "the only use
site" — false, ShellHeader and SearchTab also read `activeTabId`; each file still needs fixing
independently, the pattern just isn't unique to one file.

Leave whole-object (genuinely cross-space): `ActivePanel.tsx:31`, `Sidebar.tsx:67`,
`WorkspacesSection.tsx:8`.

### 2. PDF page canvases never get released — HIGH severity, CLEAR
`PdfPage.tsx:53-64`'s `IntersectionObserver` only ever calls `setVisible(true)`, never resets to
`false`; `PDFViewer.tsx:484` renders every page of a document at once. Every page that's ever
scrolled near the viewport (600px rootMargin) keeps a full-DPI canvas bitmap allocated for the
rest of the session — ~15-17MB per letter page at scale 1.5/dpr 2, so a long PDF can accumulate
hundreds of MB to GB over one sitting. **This is the single biggest finding in this round.**

Fix: when the observer reports a page has scrolled far out of view, set `visible=false` and
release the bitmap (`canvas.width = canvas.height = 0`, clear the text layer), keeping only a
window of nearby pages rasterized. Feasibility review confirmed this is low-risk — the
release/re-acquire path already exists for scale changes, this just needs to fire on scroll too.

### 3. Notes/folder tree has no virtualization — NEEDS TWEAK
Large vaults (hundreds-thousands of notes) render every note/folder as a real DOM node — no
`react-window`/windowing in `NotesFolderView.tsx`/`NotesPanel.tsx` (SearchTab and HistoryModal are
already capped/bounded, not a concern there).

**Correction from feasibility review:** `@tanstack/react-virtual@^3.14.2` is already a dependency
elsewhere in the codebase — no new package needed. But a nested folder tree is materially harder
to virtualize than a flat list; the realistic approach is flattening the visible tree to one array
with depth metadata, then virtualizing *that*. Real work, not a quick win — sequence after item 2.

### 4. `NotesFolderView.tsx` unmemoized recursive sorts — CLEAR, low priority
`renderUserFolder`/`renderSystemContent`/`renderDailyContent` re-run `.sort()`/`.filter()` on
every render, not wrapped in `useMemo`. Confirmed still unfixed from the prior round, and confirmed
lower priority now that the `tabs`-fanout fix already cut this component's re-render frequency.
Hoist into `useMemo` keyed on the underlying data + search query when convenient.

### 5. `VerseRow.tsx` recomputes idiom expansion every render — CLEAR
`VerseRow.tsx:376` calls `expandIdiomPatterns(idiomCache)` unconditionally on every render, and
every verse row subscribes to `idiomCache` — so this runs once per visible verse per render.
Straightforward fix: hoist to a `ChapterView`-level memo keyed on `idiomCache`'s identity, pass
the expanded result down instead of recomputing per row.

**Priority order:** #2 (PDF, high) → #1 (activeTabId, moderate, mostly mechanical) → #3 (tree
virtualization, moderate but real effort) → #4/#5 (low, opportunistic).

## Native-feel

### 1. Make "System" font actually native — CLEAR
There's already a `uiFontFamily` setting defaulting to `'system'`, but the code maps it to Inter
(a web font), not the OS font — confirmed bug at `App.tsx:494`. Fix: resolve `'system'` to
`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`; update
`tailwind.config.js:23`'s `sans` stack and `global.css`'s `body` font-family to match. Keep Inter
available as an explicit named option so nothing breaks for anyone who wants it. Note: the same
`fontMap` also has `system: 'inherit'` for scripture/notes fonts — already inconsistent with the
UI-font mapping, worth fixing in the same pass. This is the single highest-leverage "feels native"
change and the lowest-risk one here.

### 2. Add a macOS-system-accent theme preset — CLEAR
Add ONE new "System" preset (alongside, not replacing, the 32 existing `.theme-*` presets) that
binds `--color-accent` to the live macOS accent color and appearance via
`systemPreferences.getAccentColor()` / `nativeTheme`. Feasibility review found the exact IPC
pattern to clone already exists: `main.ts` already does `nativeTheme.on('updated') →
win.webContents.send('app:nativeThemeChanged', …)` with a matching `preload.ts` listener — copy
that channel for accent-color changes. No new bridge needed. `themePreset` is just a string, so
this is a pure addition with zero migration risk to persisted settings.

### 3. Corner-radius consolidation — RISKY, don't do the naive version
Proposal was to collapse ~9 radius values into a 4-step scale by redefining `rounded-shell`
(currently 14px) down to 10px. **Feasibility review found `rounded-shell` is used 128 times**
(more than initially estimated) — redefining it in `tailwind.config.js` changes the visual size in
all 128 places simultaneously, a large, hard-to-review blast radius for one config line.
`rounded-panel` (8px) is dead code (zero usages) — safe to repurpose or delete. **Recommendation:**
don't mutate `rounded-shell` in place; add new, distinctly-named scale tokens
(`rounded-control`/`rounded-container`/`rounded-surface`) and migrate call sites deliberately over
time, or treat the 128-site shift as its own explicit, separately-reviewed change — not a
drive-by rename.

### 4. Unify context menus onto one visual language — NEEDS TWEAK (scope it tightly)
Two competing looks exist: `.glass-panel` (blurred) vs. a flat bordered card. Proposal: standardize
on the flat opaque style (matches real `NSMenu` behavior — AppKit menus are crisp and opaque, not
heavily blurred) via a new `.context-menu` class, migrating `NoteContextMenu.tsx`, `TabBar.tsx`,
and `NotesFolderView.tsx` off `.glass-panel`. **Feasibility review confirmed `.glass-panel` is used
in 22 files total** (tooltips, popovers, modals — not just context menus), so this must touch only
those three files' context-menu instances, never the `.glass-panel` class definition itself.
Scoped that way, this is safe.

### 5. Shared interactive-state pattern (press + focus-visible) — RISKY, premise doesn't hold
Proposal: one shared `.btn-native` class (press scale/brightness, `:focus-visible` accent ring)
"applied at the shared button component level." **Feasibility review found there is no shared
button component in this codebase** — zero `Button` component matches, and **698 hand-rolled
`<button>` elements** across `src/`. There's nowhere to apply this "once." Honest scope: either (a)
build a real shared `<Button>`/`<IconButton>` component first and migrate call sites to it
incrementally (the bigger, more correct fix), or (b) apply the `.btn-native` class directly to a
bounded, high-traffic subset (shell chrome: Ribbon/Sidebar/ShellHeader) and explicitly accept that
coverage is partial, not app-wide. This is the largest single item in this whole list — worth its
own dedicated round rather than folding into a "quick fixes" pass.

**Priority order:** #1 (font, clear + highest leverage) → #2 (system accent, clear, infra ready) →
#4 (context menus, needs tight scoping but contained) → #3 (radius, real design work before any
code) → #5 (interactive states, biggest lift — needs its own planning round, likely starting with
"should we build a shared Button component" as its own decision).

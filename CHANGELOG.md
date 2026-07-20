# Changelog

All notable changes to Berean are recorded here.
Format: `## [version] — YYYY-MM-DD` with bullet points below each entry.

<!--
════════════════════════════════════════════════════════════════
  RELEASE WORKFLOW — for Michael's reference (not shown to users)
════════════════════════════════════════════════════════════════

QUICK COMMAND REFERENCE (the things you usually run)
────────────────────────────────────────────────────
  npm run dev               ← run the app in development
  npm test                  ← run the test suite
  npm run build             ← type-check + build (sanity check before release)

  Ship a release:
    1. edit this CHANGELOG (move notes into a new ## [version] block)
    2. npm run tag:beta     ← cut a beta build (auto-bumps, tags, pushes)
       npm run tag:stable   ← cut the stable build (after editing changelog)

  Bundled data (Bible texts, lexicon, YouTube seed + transcripts):
    npm run transcripts:seed ← bake newly-fetched transcripts into youtube_seed.db
    npm run data:publish     ← upload data/*.db to the data-v1 release for CI
  (only needed when the bundled data changed — e.g. after fetching more transcripts;
   run transcripts:seed → data:publish BEFORE tag:stable so the new data ships)

FULL STABLE RELEASE STEPS
─────────────────────────
1. Edit this file — move [Unreleased] bullet points into a new version block:
      ## [0.2.9] — 2026-06-15
      - what changed

2. Run the tag command — it will prompt for the version number,
   then commit CHANGELOG.md + package.json together and push the tag:
      npm run tag:stable

   At the prompt, type the version you want (e.g. 0.2.9) or press Enter
   to accept the suggestion. No need to edit package.json manually.

GitHub Actions then builds Mac DMG + Windows NSIS (~10 min) and publishes
to GitHub Releases. The download page updates automatically.

BETA STEPS (no manual steps needed at all)
───────────────────────────────────────────
  npm run tag:beta    ← auto-bumps version, commits, tags, pushes
  (repeat — each call increments the beta number: beta.1 → beta.2 → …)
  npm run tag:stable  ← edit changelog first, then run — handles everything

────────────────────────────────────────────────────────────────
SCENARIO 1 — Feature release: beta testing then ship
────────────────────────────────────────────────────────────────
  pkg: 0.2.8  (after last stable)
  tag:beta   →  0.2.9-beta.1   PRE-RELEASE  (new patch series)
              users on beta channel get this, test it
  tag:beta   →  0.2.9-beta.2   PRE-RELEASE  (bug fixes, same series)
  tag:beta   →  0.2.9-beta.3   PRE-RELEASE  (more fixes)
  tag:stable →  0.2.9          STABLE       (strips suffix, commits clean version)

  What users see:
    Beta users: got beta.1 auto-updated to beta.2, then beta.3
    Stable users: saw nothing until 0.2.9 stable dropped, then got it

────────────────────────────────────────────────────────────────
SCENARIO 2 — Hotfix: straight to stable, no betas needed
────────────────────────────────────────────────────────────────
  pkg: 0.2.9  (clean, after last stable)
  Manually edit package.json version to "0.2.10"  ← required step
  git add package.json && git commit -m "chore: bump to 0.2.10"
  tag:stable →  0.2.10         STABLE  (version already clean, just tags)

  What users see:
    All users (beta and stable) get 0.2.10 on next launch check

────────────────────────────────────────────────────────────────
SCENARIO 3 — Release exactly one beta then immediately ship
────────────────────────────────────────────────────────────────
  pkg: 0.2.10
  tag:beta   →  0.2.11-beta.1  PRE-RELEASE
              looks good after quick testing
  tag:stable →  0.2.11         STABLE  (pkg becomes 0.2.11, tag pushed)

  What users see:
    Beta users got 0.2.11-beta.1 briefly, then 0.2.11 stable
    Stable users only ever see 0.2.11 stable

────────────────────────────────────────────────────────────────
SCENARIO 4 — Minor version jump (e.g. 0.2.x → 0.3.0)
────────────────────────────────────────────────────────────────
  pkg: 0.2.11
  Manually edit package.json version to "0.3.0-beta.1"
  git add package.json && git commit -m "chore: start 0.3.0 series"
  tag:beta   →  0.3.0-beta.2   PRE-RELEASE  (increments beta N, doesn't bump patch)
  tag:beta   →  0.3.0-beta.3   PRE-RELEASE
  tag:stable →  0.3.0          STABLE

  Note: first beta (0.3.0-beta.1) is the manual commit — it doesn't get a
  GitHub Release because it was never tagged. That's fine; just start tagging
  from tag:beta once you're ready for people to download it.

────────────────────────────────────────────────────────────────
SCENARIO 5 — Abandon a beta series and restart
────────────────────────────────────────────────────────────────
  pkg: 0.2.12-beta.2  (two betas out, major rework needed)
  tag:beta  would give 0.2.12-beta.3 — but you want to reset

  Option A: keep the version, just keep iterating
    tag:beta  →  0.2.12-beta.3  ...  →  tag:stable  →  0.2.12

  Option B: jump to a fresh patch (restart at beta.1)
    Manually edit package.json to "0.2.12"  (strip the suffix)
    git add package.json && git commit -m "chore: reset to 0.2.12 base"
    tag:beta  →  0.2.13-beta.1  (new series, patch bumped)
    tag:stable  →  0.2.13

  Note: old 0.2.12-beta.1 and beta.2 stay on GitHub Releases as pre-releases.
  They're visible but not shown to stable users. You can delete them from
  GitHub Releases manually if you don't want them shown at all.

════════════════════════════════════════════════════════════════
-->

---

## [0.4.9] - 2026-07-19

Notes editor
- Fixed a race condition where typing right after autosave could briefly
  revert or corrupt recent keystrokes (Enter presses undone, letters dropped,
  cursor jumping) if you paused and then resumed typing quickly.
- Fixed notes search returning no results — a database migration ordering bug
  meant the search index never got created, and a tokenizer mismatch meant
  verse-reference-shaped titles (e.g. "Genesis 1:1-3") couldn't be found by
  their own reference.
- Notes edited in one window (e.g. a floating note tab) now refresh the notes
  list in other open windows' Scripture side panels instead of going stale.
- Fixed whole-chapter notes being silently excluded from the Scripture side
  panel's "chapter notes" section.
- Fixed general/daily notes that merely mention a chapter not appearing in
  the side panel at all — they now show in their own collapsed section,
  matching the existing chapter-notes section's treatment.
- The Notes side panel's floating hover trigger no longer disappears in
  Focus mode; its hover zone is narrower and slightly delayed while focused
  so it doesn't intercept the cursor on its way to the scrollbar.
- Fixed the selection formatting bubble menu not dismissing when
  right-clicking, opening the floating search bar, or clicking elsewhere in
  the app.
- Focus mode redesigned: the top bar is now fully hidden while focused
  (previously it reappeared on hovering near the top) and the formatting
  toolbar is a floating, rounded, blurred-backdrop capsule — dimmed at rest
  outside Focus mode, fully hidden until the cursor comes near it while
  focused. Entering/exiting Focus mode now animates instead of snapping.
- Focus mode's window controls: real macOS traffic-light-style close/
  minimize/maximize buttons on the left of the toolbar (the native ones are
  hidden while focused), matching Windows-style controls on the right on
  Windows.
- Fixed a rendering glitch that showed a stray white square in the corner of
  the floating toolbar when hovering the Focus button.
- The Focus toggle is now an icon with a small hover/click animation instead
  of a text label.

Scripture reading & search
- Fixed intermittent verse navigation from search stopping short of the
  target verse on chapters with cross-reference banners or notes.
- Fixed the Presenter window's outline indicator showing the wrong region
  after a search-driven chapter jump.
- Bumped the flash-highlight duration on a searched verse so it's easier to
  spot.
- The floating search bar's word-mode (All/Any/Phrase) toggle moved next to
  the input instead of living in the footer.
- Redesigned the floating search bar's destination buttons (Scripture/Notes/
  Lexicon/YouTube) as small icon+arrow buttons in the footer, replacing
  "Advanced →".
- The floating search bar feels noticeably faster — results for the primary
  translation and notes now appear almost immediately, with additional
  apocryphal-text and YouTube results filling in a moment later instead of
  every search blocking on all of them together.
- The Presenter/Viewer window now reopens at the same position and size it
  was last at, even after fully quitting the app.

Misc
- The scrollbar is now fully hidden at rest and only appears while actively
  scrolling or when the cursor is over a scrollable area, fading back out
  about a second after you stop.

---

## [0.4.8] - 2026-07-18

Scripture reading
- The Scripture tab now participates in back/forward navigation (Cmd+[ / ])
  for the first time, including landing back on Advanced Search results as
  their own stop in the history.
- Fixed back/forward becoming permanently unresponsive after visiting a
  search-results entry once.
- Fixed an extra, invisible back/forward step being recorded on every
  chapter navigation, which made the buttons feel like they needed an extra
  click to do anything.
- Removed the inline "← Proverbs 25" / "← Search: ..." breadcrumb pills —
  redundant with the global nav pill and per-tab history.
- Fixed opening a verse from Advanced Search not scrolling down to it.
- Fixed the KJV/LXX edition-switch button being hidden for Apocrypha books
  (e.g. Sirach) that exist in both editions, and showing incorrectly for
  books that don't have a real counterpart in the other edition.
- Redesigned the chapter picker: the prev/next arrows and the book/chapter/
  edition picker now share one connected control; "add comparison panel" is
  a dashed panel icon instead of a text button, with a popover that names
  every panel already open when comparing three or more texts.
- Moved the PDF library button into the edition picker's own row.
- The "Search Scripture" button now filters the floating search bar down to
  verse results only.
- Added Sirach's traditional Prologue (previously missing entirely) as its
  own unnumbered section before chapter 1.
- Fixed LXX's "hide translator-supplied words" setting being silently
  ignored for verses that use inline Strong's numbers.

Notes editor
- Right-clicking an auto-linked verse reference or Strong's number in a note
  (main editor and the Scripture side panel) now offers a menu: open, open
  in new tab, open in floating tab, and copy actions.
- Fixed the Notes side panel's "Contents" list not scrolling to headings
  when clicked.
- Right-click menus are now mutually exclusive app-wide — opening one (or
  right-clicking empty space) closes any other open menu.
- Rebuilt the Notes side panel and Advanced Search jump-rail's floating
  hover panels with smoother animation and no more corner-clipping.
- Fixed inconsistent vertical spacing between a list item and its indented
  child compared to non-indented list items.

Lexicon
- Removed the duplicate "Used N times" line now that an Occurrences section
  already shows the same count.

Misc
- The auto-hide find bar now resets its timer while hovered, clicked, or
  typed into, instead of disappearing out from under you.

---

## [0.4.7] - 2026-07-16

Scripture reading
- Added the Didache (Charles H. Hoole translation) as a new reading edition.
- Dragging one Scripture tab onto another now combines them into a compare
  view instead of doing nothing; the dragged tab becomes the rightmost
  column.
- Fixed the Annotations panel header showing a short abbreviation (e.g.
  "T. Job") instead of the full edition name.
- Right-click on a verse occurrence in the Lexicon — both the Scripture side
  panel and the dedicated Lexicon tab — now offers Open verse / Open in new
  tab / Open in floating tab, matching between the two.
- Right-clicking empty space in the tab list now offers to open a new
  Scripture, Notes, Lexicon, or YouTube tab, or the floating search.
- New Notes tabs are now labeled "Notes" instead of "New Note" until given
  a title.

Notes editor
- Headings now go up to H6 (previously capped at H3).
- Fixed Focus mode being unreachable when a note was opened from the
  Scripture side panel; added `Cmd+Shift+U` as a global toggle from
  anywhere.
- Fixed Focus mode's layout being squeezed and cramped by the note's
  outline panel staying visible alongside the centered editor.
- Fixed the back/forward history and History modal showing a note's old
  title after it had been renamed.

Daily notes & calendar
- The sidebar calendar now updates immediately when a new daily note is
  created, instead of only after restarting the app.
- The calendar now jumps to and highlights the month of the currently open
  daily note.
- Added a button to jump back to the current month after navigating away
  with the calendar's arrows.
- Fixed today's highlight in the calendar not appearing at all — a CSS
  syntax issue was silently dropping the highlight entirely, not just
  making it faint.

Performance
- Reduced blur intensity on floating panels (Settings, History, context
  menus, floating search, etc.) to ease GPU load in situations like
  screen-mirroring a display while scrolling in the app.

---

## [0.4.6] - 2026-07-15

Notes editor
- New persistent formatting toolbar, including table row/column management
  (add row, delete row, delete column, delete table).
- Fixed the Table and Divider toolbar buttons producing a malformed,
  uneditable table instead of a real one.
- `Cmd+P` now opens print/download preview for the active note directly.
- Fixed Focus/Zen mode hiding the note's own title and header controls along
  with the sidebar, leaving no way to see or rename the note while focused.
- Fixed toolbar dropdowns (heading type, highlight, list) rendering invisible.
- Print/PDF export now shows verse/Strong's reference badges as plain bold
  text instead of clickable-looking pills.
- Bullet and numbered lists now share the same indent step.

Scripture reading
- Added a quick LXX ⇄ KJV switch button next to the Strong's toggle.
- Fixed both the quick switch button and the translation picker landing on
  the wrong chapter for Psalms, Jeremiah, Joel, and Malachi, where LXX and
  KJV/Hebrew divide chapters differently (e.g. KJV Psalm 116 splits across
  LXX Psalms 114-115).
- Fixed the text-selection toolbar (single- and multi-verse) not anchoring
  near the actual cursor, especially near the bottom of the screen.
- Fixed a brief loading-skeleton flash on every chapter/translation switch;
  added a small loading indicator for switches that take longer than usual.
- Strong's-number search now caps at 200 results with a "refine your search"
  prompt instead of rendering 1,000+ rows for common numbers.
- Fixed Escape not always closing the find bar.
- Floating search now recognizes common misspelled book names (e.g.
  "Genesys", "Philipians", "Revelaton").

Notes & History
- Fixed dragging an empty/unsaved note onto another tab silently deleting it.
- Fixed the daily-note calendar briefly flashing an empty note before
  showing the real one.
- Right-click menu on verse/cross-reference indicators no longer closes
  itself against the hover preview; added Copy verse / Copy reference.
- Fixed the History modal's "All" tab showing no icon; back/forward dropdown
  now caps at 5 entries with a "View all in History" link.

Performance
- Long chapters (e.g. Psalm 119) and highlight/find-box interactions are now
  noticeably lighter.
- Notes search is now indexed instead of scanning every note on each search.
- Faster startup: rarely-opened screens (Settings, YouTube, Onboarding,
  History, Import) no longer load until first opened, and first-launch data
  setup no longer blocks the window from appearing.
- Vault auto-export now only rewrites notes that actually changed, instead
  of every note every 5 minutes.
- Reduced startup disk activity.

Also
- Tab bar shows a pointer cursor at rest and a grabbing-hand cursor only
  while actively dragging a tab.
- Smoother side-panel resize dragging.
- Tighter verse/Strong's reference badge sizing in the Notes/Lexicon side
  panel.

---

## [0.4.5] - 2026-07-14

History, hover menus, and the Scripture side panel
- History modal now has real tabs (All / Scripture / Notes / Lexicon /
  YouTube / Search) with live counts, and shows a simple flat list instead
  of the old collapsible day/session groupings.
- The History button, and Back/Forward, now show a navigation preview on
  hover instead of requiring a click.
- Fixed Notes and Lexicon tab titles briefly flashing the previous tab's
  title when switching between tabs.
- Fixed double-clicking empty space in the tab bar not opening a new tab.
- Fixed the annotation key ("i") button on KJVA-style texts being
  unclickable — its popover was rendering clipped and invisible.
- Zoom now also scales the top bar and the Notes/Lexicon/YouTube side
  panel, not just the Scripture/Lexicon reading text.
- The Scripture side panel now animates open/close instead of snapping.
- Hover now opens every "..." menu and the rail's Zoom control, not just
  Back/Forward/History.
- Refreshed look for the Scripture side panel's Notes, Lexicon, and
  Cross-references tabs: each note's assigned color now shows as a dot in
  the notes list, and reference labels are now accent-tinted badges.

---

## [0.4.4] - 2026-07-11

Design refresh — Arc/Zen-inspired glassy chrome, motion, and typography
across the shell, Bible panel, and notes editor:
- Sliding pill/underline indicators (sidebar, tabs, right-panel tabs) instead
  of hard-cut backgrounds; frosted-glass treatment on every floating menu and
  tooltip; real open/close animation on floating search and the Cmd+Tab
  switcher (previously dead CSS classes with no effect).
- Notion/Obsidian-style note typography: bigger heading scale, wikilinks as
  tinted pills, callout boxes that stay styled while editing instead of
  reverting to flat raw markdown.
- True native sidebar vibrancy on macOS (frosted translucency against the
  desktop, not just CSS blur).
- One shared highlight-color source of truth (was defined 3x and had drifted)
  and a themed red-letter color that now adapts across all 19 theme presets.

Bug Fixes
- Highlight color picker showed blank swatches instead of colors.
- New tabs from cross-references (Strong's/wikilinks/verse refs) landed in an
  unpredictable spot instead of the end of the tab list; dragging a tab below
  the list didn't move it to the end (or got stuck on a fast drag).
- Tab titles and the book/chapter picker briefly flashed a generic
  placeholder ("Notes", "GEN") when switching tabs before showing the real title.
- Notes list caused a multi-second stall switching from folder view to list
  view once the note collection grew past a couple hundred — now virtualized.
- Verse note indicator dots now reflect the note's assigned color.
- Presenter outline band survives zoom/tab-switching; scroll position resets
  correctly on edition switch; a mis-split Hermas Mandate 3 chapter was merged.

Sidebar/rail redesign — replaced the old single-column sidebar with a
slim icon rail plus a browser-style Explorer pane:
- Rail is now the single home for History, Archived tabs, Presenter view,
  Find, Zoom, and Settings — previously scattered across the top bar's
  "More" menu and duplicated as separate buttons inside the Bible/Notes/
  Lexicon panels.
- Sidebar leads with a row of "new tab" tiles (one per space, icon crossfades
  to a plus on hover) instead of three different, overlapping ways to open a
  tab; the unified tab list is unchanged (still flat, unfiltered) but each
  row's icon is now tinted per tab type for a quicker scan.
- A month-view daily-notes calendar is pinned permanently at the bottom of
  the sidebar instead of a Notes-only toggle.
- Sessions moved out of the sidebar into numbered chips at the bottom of the
  rail; right-click a chip to rename it, change its icon (shown in place of
  the number once set), or delete it — previously only reachable through
  Settings.
- Sidebar collapse/expand now animates instead of an instant show/hide; a
  floating-search button appears at the top of the rail while collapsed so
  search/new-tab is still reachable.
- Zoom (⌘+/⌘−/⌘0 and the rail's Zoom control) is now one shared value
  covering Scripture, Lexicon, and the side panel, applied only within those
  reading panes and to tab-list/sidebar text — no longer resizes the sidebar,
  rail, or window itself.
- History modal background is fully solid instead of translucent.

More fixes
- Sidebar tab list sometimes wouldn't scroll — part of the list was inside
  Electron's window-drag region.
- Presenter outline band could go stale (not just at zoom/tab-switch) when
  changing reading zoom, base font size, or toggling word-replacer/idiom
  highlighting, since none of those resized the scroll container itself.
- A Radix Tooltip behavior (an invisible "hoverable content" area kept open
  between a trigger and its tooltip) was intercepting clicks on nearby
  menus — most noticeably the session icon picker; disabled app-wide since
  none of Berean's tooltips have interactive content that needs it.
- Right-clicking a session chip while the quick-switch popover was open
  left both open and overlapping at once.
- Auto-update: startup check now retries once on failure instead of giving
  up silently; install failures are now surfaced instead of failing
  silently; added a "last checked" timestamp and an update-available badge
  on the rail's Settings icon.

---

## [0.4.3] - 2026-06-23

- Added strongs for LXX
- Updated advanced scripture search tab
- Updated floating search
- Various bug fixes (Presenter view, etc.)

---

## [0.4.2] - 2026-06-19

- Compare panels in presenter view

Bug Fixes:
- Updated Shepherd of Hermas mapping
- Notes formatting fixes
- Presenter view fixes
- Scripture fixes

---

## [0.4.1] - 2026-06-18

- Presenter view (laser, select, etc)

---

## [0.4.0] - 2026-06-16

- Presenter view
- Idiom notes

Bug Fixes
- Easier to open zoom and change it

---

## [0.3.15] - 2026-06-11

- Vault improvements

Bug Fixes:
- Floating tab fixes
- Lexicon derivation fixes
- Scritpure text fixes

---

## [0.3.14] - 2026-06-10

- Tab's history updates

---

## [0.3.13] - 2026-06-09

- Added missing septuagint books
- Daily notes show in year/month folders
- Copy verses from advanced scripture search
- Compare shows corresponding septuagint chapter
- Combine scripture tabs to compare
- Type '--' to create a dash in notes
- Compare scripture updates (highlights, notes, etc.)
- Zoom in tabs and side panels
- View tab's history

Bug Fixes:
- Highlight fixes
- YouTube transcript fixes
- Findbar fixes
- Notes formatting fixes
- Mac updater fixes
- Slight UI changes

---

## [0.3.12] - 2026-06-08

- Reverse cross references
- Chapter cross references show on chapter
- **YouTube transcripts** — videos now ship with their full transcript:
  - Synced transcript panel in the player: the current line highlights as the video
    plays, auto-scrolls, and clicking any line jumps the video to that moment
  - Transcript search: the YouTube search box can search title, transcript text, or
    both (in *More filters → Search in*), ranked by relevance ("Best match" sort)
  - Transcript matches show the matching line as a highlighted snippet on the card
  - Floating search (⌘K) surfaces transcript matches with the matching line
  - Bundled with the app (884k caption lines across 2,059 videos) and merged on first
    launch; HTML entities in captions are decoded for clean display
  - Dev-only fetch tooling (tactiq.io, parallel workers, batch size) behind a popover

Bug fixes:
- Lock creating notes/folders in system folders
- History modal fixes

---

## [0.3.11] - 2026-06-08

Bug fixes:
- Highlight fixes
- BDB fixes

---

## [0.3.10] - 2026-06-08

- Cross ref verse hover improvements

---

## [0.3.9] - 2026-06-07

- General bug fixes

---

## [0.3.8] - 2026-06-06

- Note history
- See LXX connections in KJV

Bug Fixes:
- LXX verse block fixes
- Notes fixes
- 'GOD' is also replaced to 'Yehovah'
- Jubilees text rendering fixes
- History modal bug fixes
- Floating search bar fixes

---

## [0.3.7] - 2026-06-06

- Better tooltips

Bug Fixes:
- Findbar fixes
- Notes fixes
- 'GOD' is also replaced to 'Yehovah'
- Jubilees text rendering fixes
- History modal bug fixes
- Floating search bar fixes

---

## [0.3.6] - 2026-06-05

- Scripture & strong's auto formatted blocks
- Print and download settings
- Default download setting
- New tabs open below active tab
- Right-click options in scripture search to open in new/floating tab
- Lexicon copy button
- Archive tabs

Bug Fixes:
- Various pdf/print issue fixes
- Hebrew lexicon not linking to other hebrew strongs numbers
- Empty notes no longer delete when switching tabs
- Word replacer now edits cross reference verse text

---

## [0.3.5] - 2026-06-04

- Added Elseus → Elisha in word replacer
- Strong's toggle now doesn't jump scripture
- Decreased verse spacing on Strong's toggle
- Added 10 new print/download themes
- Verse blocks are now rounded

Bug Fixes:
- Removed random paranthesses from scripture
- Fixed occurrences not all showing in lexicon
- Added back `'s` for the word replacer of 'Yehovah'
- Fixed margin adjustment for print/downloads
- Stripped internal links when printing/downloading note

---

## [0.3.4] - 2026-06-03

- Ability to use special characters in note names
- Print and download settings
- Default download setting

Bug Fixes:
- Fixed download and print view

---

## [0.3.3] - 2026-06-03

- Changelog now visible on website

Bug Fixes:
- Fixed download and print view

---

## [0.3.2] - 2026-06-03

- Word replacer now includes LORD → Yehovah
- Right-click empty space in notes folder view

Bug Fixes:
- Fixed Cmd+L in advanced scripture search tab
- Verse selection menu off-screen

---

## [0.3.1] - 2026-06-03

Bug Fixes:
- Fixed Mac build

---

## [0.3.0] - 2026-06-02

Bug Fixes:
- Mac app opens

---

## [0.2.13] - 2026-06-02

- Word replacer works in lexicon

---

## [0.2.12] - 2026-06-02

Bug Fixes:
- Fixed Windows show bible/lexicon data

---

## [0.2.11] - 2026-06-02

- Windows now has custom title bar and window controls

Bug Fixes:
- Fixed Windows show bible/lexicon data
- Fixed Windows floating tabs top bar

---

## [0.2.10] - 2026-06-02

Bug Fixes:
- Fixed git builds

---

## [0.2.9] - 2026-06-02

Bug Fixes:
- Fixed git builds

---

## [0.2.8] - 2026-06-01

- Getting Started folder: 10 linked guide notes created on onboarding
- Settings → Updates: beta channel toggle, GitHub Pages link, cleaner MAS build UI
- Settings → About: "Recreate Getting Started notes" button
- Windows: native OS window chrome (title bar on right), platform-conditional traffic light spacer
- GitHub Actions CI: automated Mac + Windows builds on version tag push
- GitHub Pages: download landing page with dynamic release version detection
- Added escape character `\` to disable markdown when needed

Bug Fixes:
- Fixed markdown not working in tables
- Fixed scroll position retaining when going to different notes
- Fixed system them auto-switcher
- Fixed advanced scripture tab opening existing tab instead of a new tab
- Fixed edit view of note showing raw markdown

---

## [0.2.7] - 2026-06-01

- Full Berean app — Bible reader, notes, lexicon, YouTube, search, MAS build config
- Notes: WYSIWYG markdown editor with live rendering (CodeMirror 6)
- Verse notes with color indicators, collapsible headings, bullet style picker
- Strong's inline numbers, hover tooltips, full lexicon tab
- Highlighting system with 5 colors, + Note from highlight
- Full-text search with FTS5, word replacer, note search
- YouTube embedded webview with allowlist, auto-PiP, timestamp linking
- Vault sync to local Markdown folder (iCloud/Obsidian/Octarine compatible)
- Compact settings UI with toggle, keyboard shortcut display
- PDF import and viewer subsystem
- BibleGateway and e-Sword note importers
- Onboarding wizard (7 steps)
- Keyboard shortcuts for all major features
- Auto-updater via GitHub Releases (skipped for MAS builds)

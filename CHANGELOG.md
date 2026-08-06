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

## [0.4.18] - 2026-08-05

Advanced Scripture Search
- Fixed a tab opened from a search result still reverting its title back to
  the search query after a brief delay, in a case the previous fix didn't
  fully cover.
- Fixed the results list occasionally freezing for a moment while typing a
  query with a large result set (e.g. a common Strong's number).

Presenter / Viewer window
- Fixed the presenter window pinning a jumped-to verse to the very top of
  the screen instead of centering it with surrounding context, when jumping
  via Advanced Scripture Search or the floating search.

Notes
- Selection/highlight toolbar no longer appears right under the cursor after
  selecting text, reducing accidental clicks on it.

Vault sync
- Fixed the vault-sync file watcher continuing to run in the background
  after turning vault sync off in Settings.

## [0.4.17] - 2026-08-04

Notes
- Fixed notes tabs (including the general Notes list) flashing briefly when
  switching to them — most noticeably right after restarting the app, or
  when switching directly between two already-open note tabs.
- Fixed a reopened note losing its scroll position and cursor placement.
- Fixed literal highlight/underline markup occasionally showing up as raw
  text in the notes list preview instead of rendering as formatting.

Advanced Scripture Search
- Fixed a tab opened from a search result occasionally reverting its title
  back to the search query instead of staying on the scripture reference.

Bible reading
- Reduced a brief flash when switching back to an already-viewed chapter.

Lexicon / Search / PDF
- Scroll position is now reliably preserved when switching tabs quickly, in
  the Lexicon panel, the Search tab, and the PDF viewer.

## [0.4.16] - 2026-07-31

Scripture reading side panel
- The side panel can now hold a set of tabs (Notes, Lexicon, Cross-refs)
  rather than just one — pop a tab out into a second panel and it keeps
  whichever tabs you leave it holding onto, and the popped-out panel now
  sits to the left of the main one instead of the right.
- Dragging a tab out of the panel to pop it out now responds instantly
  instead of after a brief delay.
- Each panel now shows a real visual gap from the other, and a panel's tab
  strip no longer offers a tab that's already open in the other panel.
- Notes/Lexicon/Cross-ref data is now shared between both panels instead of
  being fetched twice when they're showing the same chapter.

Sidebar
- The sidebar can now be resized by dragging its edge (224–250px), and the
  gap between the sidebar and the icon rail next to it is smaller.
- Tab hover tooltips for multi-book editions (Recognitions of Clement,
  Shepherd of Hermas, and similar works) now show the full work name with
  the book/section name at the end, e.g. "Recognitions of Clement 5, Book
  3", instead of a truncated or misordered label.
- Dragging from empty space below the tab list now moves the window.

Notes
- Fixed a note losing a trailing blank line at the end after switching away
  from its tab and back.
- Fixed reopening a notes tab briefly flashing the notes list before
  showing the note itself.
- Reduced false positives and incorrect merging when auto-detecting
  scripture blocks while typing or pasting.
- Mitigated a case where OS-level text replacement (e.g. Raycast snippets)
  could occasionally double-replace text.
- Notes list scroll position and continuous-daily-scroll position are now
  preserved across tab switches.

Highlighting
- Fixed highlights not rendering in KJV and every book other than KJVA/LXX
  when Strong's numbers are hidden and no search is active — highlights
  created since the switch to character-offset storage never rendered in
  that default reading view for those texts.

Advanced Scripture Search
- Fixed Strong's-number search results not truncating around the actual
  match.
- Fixed scroll position being lost when navigating back to search results
  from a result.
- Books with no matches are now hidden from the Scope checklist.

Lexicon
- Fixed a crash ("Maximum update depth exceeded") triggered from the
  Lexicon search view.
- Search query, language, and results scroll position are now preserved
  across tab switches, and the tab-switch flash is gone.
- Removed a redundant "Show less" button.

Compare mode
- Tab title now shows the reference and translations being compared (e.g.
  "Exodus 3 KJVA / LXX") instead of a generic "Compare — " label.

YouTube
- Fixed transcript search taking multiple seconds on some queries.
- Fixed transcript fetches for Shorts and completed livestreams being
  skipped entirely.
- Fixed rate-limited (429) transcript fetches being permanently marked as
  failed instead of retried.
- Fixed transcript-fetch background windows briefly producing audible
  playback.
- Toolbar dropdown menus (Channel, Sort, Transcript tools) no longer get
  clipped by the header and are sized to their content.
- Browse-grid scroll position is now preserved across tab switches.

Presenter window
- Reduced side margins and moved verse numbers into their own gutter
  instead of sitting inline before each verse.

Data
- Added 2 Baruch as a new pseudepigrapha book, and fixed inline topic
  subheadings that had leaked into the verse text.
- Corrected a stray manuscript-folio marker ("265b") that had leaked into
  Gad the Seer 10:39.
- Re-seeded the Testaments of the Twelve Patriarchs from an independent OCR
  source.
- Rewrote the Septuagint (Brenton) Greek Strong's-number alignment pass,
  and fixed several verses (including Isaiah 27:13) where two adjacent
  Strong's numbers had been swapped between English words.

General
- New tabs now follow consistent placement rules across all spaces.
- Fixed floating search / PDF tabs occasionally opening blank, and clicks
  on floating or duplicate tabs being swallowed.

---

## [0.4.15] - 2026-07-26

Notes — Idiom entries
- Idiom notes redesigned: only Term and Meaning show by default now.
  Aliases, Explanation, Compare to, and References are added one at a time
  via a new "+ Add field" button instead of all appearing together.
- Scripture references already auto-detected for PDF export now show live
  while editing, so matches don't need to be retyped into References.
- "Match plurals" and example sentences moved into a small settings menu,
  out of the main field flow.
- The New Idiom button moved next to New Note/New Folder, out of the top
  bar.
- Fixed a bug where pasting a verse passage with blank lines between the
  reference and each verse (common with rich-text pastes) failed to format
  into a verse block.

Scripture reading
- Fixed the two-finger trackpad swipe to open/close the side panel feeling
  choppy and getting stuck when reversing direction mid-swipe — rebuilt for
  smoother, lower-latency tracking, with a new Settings toggle to turn the
  gesture off entirely.
- The Bible reading side panel's note editor now uses narrower margins.
- Septuagint (LXX) chapters now show a small note when a KJV verse is
  absent from that passage.
- Strong's lexicon "Definition" text now links bare cross-reference
  numbers (e.g. "See 7495") the same way the Derivation section already
  did.
- Update-download progress now shows directly in the top bar, whether
  started manually or via auto-download.
- Fixed floating search (Cmd+K) not navigating to a specific verse for
  reference-style queries.

Compare mode
- Scroll-sync now also syncs chapter navigation across columns, including
  books like Jeremiah and Psalms where KJV and LXX use different chapter
  numbering.
- Scroll position is now saved and restored per column across tab
  switches.
- The tab title now updates as columns navigate, instead of staying frozen
  at whatever it was when Compare mode was first turned on.

Advanced Scripture Search
- The book jump rail now scrolls instantly instead of a slow smooth-scroll.

Ctrl+Tab switcher
- Shows only the 5 most recent tabs as preview cards; anything beyond that
  appears in a compact list below instead of growing unbounded.
- No longer selects whatever tab happens to be under a stationary cursor
  when the switcher first opens.

Data
- Corrected dozens of OCR errors across the Testaments of the Twelve
  Patriarchs, and separated section titles from verse text.
- Fixed daily notes showing every note as "edited today" after a vault
  export.

---

## [0.4.13] - 2026-07-25

Idioms export
- Idiom entries no longer include numbered example sentences in the exported
  PDF. Each idiom's known aliases are shown instead, as an "Also: ..." line
  under the term.
- "Compare to" references now link directly to that idiom's own entry within
  the same exported document, when the compared idiom is included in the
  export.

---

## [0.4.12] - 2026-07-25

Floating search
- The search bar now predicts which space a plain keyword search is most
  likely aimed at (Scripture, Notes, or YouTube) and shows it as ghost text
  right after what you've typed — pressing Enter with nothing else selected
  jumps straight there. Nothing is highlighted by default anymore; use the
  arrow keys or hover a result to select it.
- The Advanced Scripture Search button now matches the plain "↑↓ Navigate /
  ↵ Open" footer hints instead of standing out as its own accent-colored
  button.
- The All/Any/Phrase word-matching toggle is now a dropdown instead of a
  three-button switch.
- Fixed being unable to click options in the word-matching dropdown —
  clicks were passing through to whatever was behind it.
- The Notes/Lexicon/YouTube destination buttons are now hidden when the
  search bar is opened from the Scripture tab's own "Search scripture"
  shortcut, since that entry point is scripture-only.
- "Recognitions of Clement" and "Shepherd of Hermas" references now parse
  correctly when searching — e.g. "Recognitions of Clement 5" goes to Book
  5 (not chapter 5 of Book 1), and Hermas can be addressed by its
  traditional Vision/Mandate/Similitude numbering.
- Keyboard-shortcut glyphs (⌘⇧⌥⌃↵ and arrows) now render as real icons
  instead of plain unicode characters.
- Fixed the floating icon rail's idle dots abruptly disappearing on hover
  instead of fading smoothly.

Compare mode
- Each column's book/chapter/edition picker is now a single unified pill
  matching the main reading view, replacing the old two-row header.
- Columns can now be reordered by dragging instead of using move-left/
  move-right buttons.
- Added a scroll-sync toggle: when two or more columns are showing the same
  chapter in different translations, scrolling one keeps the others aligned
  by verse.
- Minor hover-consistency fixes across the column toolbar.

Scripture reading
- The right side panel (Notes/Lexicon/Cross-refs) can now be opened and
  closed with a two-finger trackpad swipe, sliding in from the edge like
  macOS's Notification Center.
- Fixed the TSKe cross-reference panel showing literal HTML like
  "the Lord&#x0027;s" instead of an apostrophe.
- The LXX indicator chip in the book picker is now a shorter pill.
- Fixed a mismatched gray background showing behind the top bar's rounded
  corners in light mode.
- Fixed an unnaturally heavy shadow on the Scripture side panel.

---

## [0.4.11] - 2026-07-23

Scripture search
- The Advanced Scripture Search "scope" filter (which editions/books to
  search) is no longer split across three tabs — it's one unified,
  searchable list now, and typing in it filters editions, testaments, and
  books all at once instead of only whichever tab happened to be open.
- Multi-book pseudepigrapha editions — Recognitions of Clement, Shepherd of
  Hermas, Testament of the Twelve Patriarchs — can now be filtered down to
  individual books/sections (e.g. just "Visions" instead of all of Hermas),
  each with a "Select all" shortcut.
- Number searches now also match the written-out word form and vice versa
  (e.g. searching "7" also finds "seven", and "fourscore" also finds "80"),
  in both Scripture search and note search, with matches highlighted either
  way.
- The floating "jump to book" rail in search results is narrower, uses a
  clearer icon, and no longer truncates long book names.
- Search tabs (both the Notes search tab and Advanced Scripture Search) now
  show what you searched for directly in the tab itself, updating as you type.

Notes
- Fixed renaming a note sometimes silently failing — clicking the title was
  occasionally mistaken for dragging the window instead of starting an edit.
- Fixed the auto em dash setting ("--" → "—") never actually converting
  while typing.
- Fixed searching for a note that has no title ("Untitled").
- Fixed duplicating a tab sometimes doing nothing instead of creating a copy.
- The Strong's/verse "suggest a block" popup settings are easier to find —
  previously tucked inside a collapsed "Advanced" section in Settings.

Shell & Settings
- The global icon rail (search, history, archived tabs, presenter, zoom,
  settings) now floats and expands on hover instead of sitting permanently
  docked in its own column.
- Fixed the top bar's rounded corners revealing a mismatched background
  color behind them.
- Settings no longer has a compact/expanded toggle — descriptions are
  always visible now.
- Fixed low-contrast text in a couple of Settings' informational callout
  boxes that could be hard to read on lighter themes.
- Berean now checks for updates periodically while open (every 5 minutes),
  not just once at launch.

Sidebar
- The Daily Notes calendar's month navigation is now left-aligned with a
  "Today" button on the right, and hovering a date shows which day it is.
- The daily note breadcrumb now shows its date as its own segment
  (Notes › Daily › 2026-07-24) instead of folded into one label.
- Removed the redundant "SESSIONS" label from the session switcher menu.

---

## [0.4.10] - 2026-07-20

Shell
- Ribbon, Sidebar, and the top bar now read as one continuous surface instead
  of four visibly stitched-together panels — merged into a single header bar
  with shared material/vibrancy, matching corner rounding, and a synced
  collapse animation.
- Context menus (note right-click, tab bar, notes folder view) now use a
  flat, opaque style matching real macOS menus instead of frosted glass.
- Buttons in the Ribbon, Sidebar, and header now have a subtle press effect
  and a real keyboard focus ring.
- The "System" UI font option now resolves to the real macOS system font
  instead of silently falling back to Inter.
- Added a "System" theme preset that follows your live macOS accent color
  instead of a fixed one.

Scripture reading & search
- Fixed verse navigation from search still not landing on the target verse
  in some cases (typing a reference like "Jer 51:13" and pressing Enter) —
  the previous fix covered one race condition but not the more common case
  where the previous chapter's verses briefly linger in state during the
  navigation, silently cancelling the pending scroll before the new chapter
  ever loaded.
- Fixed the Advanced Search input swallowing the letter "k" while typing
  (it was bound as a vim-style "move up" shortcut on the same field you type
  your query into — e.g. typing "dark" silently dropped the k). Replaced
  with Arrow Up/Down only.

Notes
- Note titles in the tab header are now draggable (moves the window) by
  default, and a click activates editing — previously the title was always
  a live text field, which silently blocked window-dragging from that part
  of the header.
- Right-click a date in the sidebar's Daily Notes calendar (or the "Today"
  shortcut) for Open / Open in new tab / Open in floating tab / Delete note.

Experimental
- Added a Settings → Experimental section. PDF import/viewing is now an
  opt-in toggle there, off by default — long PDFs can build up significant
  memory over a session since viewed pages aren't released yet; this hides
  the PDF library and viewer until turned back on. Existing imported PDFs
  are unaffected.

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

# Full native app audit — Claude Code, 2026-11-26

Owner request (Nov 26): audit the entire app for issues, bugs, things to update or fix, and things that don't make sense; record them all; test every way a user would use the desktop and iPhone apps.

Build: `native/reader-notes` @ `524a1976` (app source = Codex `2bb1670d` + Claude docs). iPhone: Claude's simulator E8B01B22 (iPhone 17 Pro, iOS 27), real taps. Mac: Claude's isolated QA instance (`--qa-library --qa-profile claude-20261120`), AX/PID-scoped input only. Codex's D0CC simulator, Codex's QA library, owner process PID 2506 and the physical phone are untouched. Fixtures are `qa-` prefixed and removed afterwards.

Severity: **S1** broken/data risk · **S2** wrong behaviour a user will hit · **S3** confusing/inconsistent · **S4** polish.

## Findings

| # | Sev | Platform | Area | Finding | Repro |
|---|---|---|---|---|---|
| A1 | S4 | iPhone | Reader | Italic supplied words inside red letters render black (italic run drops the words-of-Yeshua colour). | John 3:5 "born of water and *of* the Spirit" — "of" is black italic between red words. |
| A2 | S3 | iPhone | Reader · highlight | Highlight colour menu shows every swatch as a **black** dot (menu renders the symbol monochrome), so colours can't be told apart; "Remove Highlights" is offered even when the selection has none. | Select a verse → pen icon. |
| A3 | S3 | iPhone (both?) | Reader · More menu | Item reads **"Copy Native Dev Links"** — the build's display name leaks into a command label; meaningless to a user (production would presumably read differently). | Select a verse → … |
| A4 | **S2** | iPhone | Study sheet | **Tapping "Lexicon" doesn't select it**: the centre segment sits under the sheet's grab handle, whose tap toggles the detent instead (sheet jumps medium↔large, tab unchanged, `rightPanelTab` not written). Tapping the left part of the segment works. Fix: inset the segmented control below the drag indicator (top padding) in `StudyInspector.pane` iOS branch. | Select a verse → … → Cross References → tap "Lexicon" centre. Repeats every time. |
| A5 | S4 | iPhone (shared) | Lexicon | Definition begins with a stray leading space (" to procreate…"); trim on display. | G1080 entry. |
| A6 | S4 | iPhone | Study sheet | Low-detent glass sheet lets the dock's blue search button show through behind content rows. | Cross Refs at medium detent. |
| A7 | S3 | both (shared text) | Reader · LXX | Word Replacer turns KJV "LORD" into "Yehovah" but LXX (Brenton) still shows "the Lord" in the same study flow, so switching KJVA⇄LXX changes the Name. Confirm intended scope (original rules) or extend the rule set to Brenton's mixed-case forms. | Psalm 24 (KJVA) → ⇆ → LXX Psalm 23. |
| A8 | S3 | iPhone (check Mac) | Reader · Strong's | Inline Strong's numbers can wrap to the next line apart from their word (e.g. "fulness / H4393 thereof"), and sit after trailing punctuation ("Yehovah's, H3068"), so it is unclear which word a number belongs to. Bind number to word with a non-breaking join and place it before punctuation. | Psalm 24:1 with # on. |
| A9 | S3 | iPhone | Reader top bar | In **Compare mode** the bar spacing is unequal again (# ↔ passage ≈10 pt, passage ↔ Manage Translations ≈40 pt) — contradicts the owner's Nov 22 equal-gap request, which was only applied to the normal bar. | Open Compare on any chapter. |
| A10 | S4 | iPhone | Find in Chapter | Only the current match is highlighted; the other matches ("1 of 6") are unmarked, so you can't see where the rest are. | More → Find in Chapter → "Yehovah" in Psalm 24. |
| A11 | S4 | both | Naming | Reader title says "Psalm 24" but Go-to results and new verse-note titles say "Psalms 23:1–6" / "Psalms 24:1". Use one convention (singular for a single psalm, as the reader does). | Go to "ps 23:1-6"; Add Note on Psalm 24:1. |
| A12 | S3 | iPhone | Notes from reader | **Add Note** opens the note in a *new Notes tab*; the editor's Back goes to the Notes home, not back to the passage you were reading, so returning needs the tab switcher. | Psalm 24:1 → … → Add Note → type → ‹. |
| A13 | S4 | iPhone (check) | YouTube timestamp | Channel name is read with desktop-YouTube selectors (`#owner #channel-name a, ytd-channel-name a`); on the mobile page the iPhone loads, the channel part is likely missing (label becomes "Title — m:ss"). Needs a device/sim check with a real video. | Code: YouTubeTabView `markdown(timestamp:)`. |
| A14 | **S2** | iPhone (check Mac) | Notes · Trash | **Delete Permanently runs immediately with no confirmation** — an irreversible deletion one tap from a context menu (Empty Trash… does confirm). Add a destructive confirmation. | Trash → long-press a note → Delete Permanently. |
| A15 | S4 | iPhone | Notes · Trash | *(Corrected: swipe right = Restore and swipe left = Delete do exist.)* No visible Restore control besides swipe/long-press. A New Note (compose) button sits in the Trash toolbar, which doesn't belong there. | Open Trash. |
| A16 | S4 | iPhone | Notes · accessibility | VoiceOver label "Trash, 1 notes" (no singular). | Notes home with one trashed note. |
| A17 | S4 | iPhone | Notes · search | Search results don't highlight the matched word in the preview. | Notes → search "audit". |
| A18 | **S2** | iPhone | Deep links / app routing | Opening a link while a sheet is presented (e.g. the Tabs sheet) leaves the sheet up; the destination (daily note) opens **behind** it while its keyboard and editor toolbar appear **over** the sheet. Routing should dismiss presented sheets/popovers first. Affects Spotlight, Shortcuts, widget and `berean-native-dev://` links. | Open Tabs sheet → `xcrun simctl openurl … berean-native-dev://daily`. |
| A19 | S3 | iPhone | Accessibility · menus | Several menu rows expose their SF Symbol as a separate element with the symbol's spoken name ("Gear shape", "Books standing vertically on a shelf", "Left speech bubble and right text bubble") beside the real label — VoiceOver noise. Hide decorative icons / use `Label`. | Dock ••• menu on the Notes tab; inspect accessibility tree. |
| A20 | S4 | iPhone | Settings · Reading | Section header "Reading" repeats the screen title; "Shepherd of Hermas edition" puts its value on a second line under the label, unlike every other row. | Settings → Reading. |
| A21 | S3 | iPhone | Settings · About | "Library → Location" prints the raw sandbox path (`/Users/…/CoreSimulator/…/Application Support/BereanNative`) — meaningless on iPhone. Show "On this iPhone" (and the path only on Mac). Section header "About" repeats the title. | Settings → About. |
| A22 | S3 | Mac | Menu bar | The bold application menu title reads **"BereanMac"** (target/bundle name) while its items say "Berean Native Dev"; set `CFBundleName` to the display name (production: "Berean"). | Look at the menu bar. |
| A23 | S4 | Mac | Go menu | "YouTube" appears twice (destinations group and spaces group). | Go menu. |
| A24 | S3 | Mac | Window menu | AppKit window tabbing is enabled: View → Show Tab Bar / Show All Tabs and Window → Show Previous/Next Tab, Move Tab to New Window, Merge All Windows refer to *system window tabs*, a second "tab" concept next to Berean's sidebar tabs. Disable automatic window tabbing (`NSWindow.allowsAutomaticWindowTabbing = false`) unless deliberately supported. | View / Window menus. |
| A25 | S4 | Mac | Help menu | "Berean Native Dev Help" has no help book behind it (macOS shows "Help isn't available"); point it at the Getting Started checklist or remove. | Help menu. |
| A26 | S4 | Mac | Settings · Reading | Word Replacer is a checkbox while every other on/off row is a switch. | Settings → Reading. |
| A27 | S3 | iPhone vs Mac | Settings parity | Mac has "Underline Idioms in Scripture" and "Layout for new Scripture tabs"; iPhone Reading has neither (idiom underline can't be turned on/off on iPhone). Confirm intended per-platform scope. | Compare both Reading panes. |
| A28 | **S2** | Mac | Reader + Study panel | **Opening the Study panel slides the reader under the toolbar**: the floating "‹ John 1 ›" passage control sits on top of verse 1 and hides its text (content inset lost when the inspector appears). | John 1, ⌥⌘I (Study Panel). |
| A29 | S3 | Mac | Accessibility | One window button has no accessibility label (between the sidebar's Messages button and the selection bar's Copy Verses); sidebar tab rows announce the tab's *space* rather than its kind ("PDFs, Scripture", "QA Image Note, YouTube") and repeat their help text twice. | AX inspection of the main window. |
| A30 | S3 | Mac (both) | Strong's | A8 reproduces on Mac: numbers wrap to the next line away from their word (John 1:12 "…sons" / "G1096 the sons"). | John 1 with Strong's on. |

| A31 | S4 | Mac | Getting Started | The checklist's intro line is truncated ("…Swipe or right-click a step to ma…"); let it wrap. | Help → Berean Help — Getting Started. |

| A32 | S3 | iPhone | Study Trail | The large navigation title is invisible on the Study Trail list and on a trail (a blurred smudge where "Study Trail" / "Feasts trail" should be); trail controls use 12 pt padding, slightly less than the cards below (minor). | ••• → Study Trail; open a trail. |
| A33 | Intentional | both | Daily notes · Calendar | Both originals create daily notes on date navigation and explicitly exempt them from empty-note cleanup. Retain the row/count and native faded empty-note dot; deleting on leave can redirect date links away from metadata/history. [Source reconciliation](DAILY-NOTE-RETENTION-2026-11-26.md) | Source-verified; no cleanup change. |
| A34 | S4 | iPhone | Calendar / menus | Calendar opens as a new tab each time from Study Tools; its row of icon-only buttons (layout, list, sunrise) has no visible labels. History isn't in the iPhone Study Tools menu at all (only under Settings → History). | ••• → Study Tools → Calendar. |

| A35 | S2 | Mac | Presenter | The audience view starts with verse 1 under the Presenter's transparent title bar (first line blurred, chapter heading off-screen). It mirrors the main reader's viewport, which has the same offset (A28) — changing the Presenter's own heading anchor had no effect, so the fix belongs with A28 in the main reader. | John 1 → Window → Show Presenter. |
| A36 | S4 | Mac | History | Repeated identical searches are listed as separate rows ("voice of joy" twice today). | Go → History. |

| A37 | S4 | iPhone | Tags | The Tags screen has no title (blank gap above the filter field), and its empty-state hint says "Tag Verse…", but the real control is the tag icon / "Tag Selected Verses…". | ••• → Study Tools → Tags. |
| A38 | S3 | iPhone | Ask Berean | After asking, the keyboard stays up and covers the answer (only the first heading, "Strong's H2580", is visible); the example list also stays above the result. Dismiss the keyboard on submit and collapse the examples once there's an answer. | Ask Berean → "word study on grace" → Return. |

| A39 | S3 | both | Notes | *(Re-scoped after reading the original.)* The original's leave rule (finalizeNote.ts) exempts verse/daily/journal/import notes — so an empty **verse** note persisting matches it — but it trashes abandoned **untitled general** notes and date-names untitled notes with text. Native had no leave rule at all. | Compose a note, go Back without typing; it stayed as an empty "Untitled". |

## Coverage of this pass

- **iPhone (real taps):** launch; reader tap-select, multi-select, Copy (single/non-contiguous), Highlight, More menu, Cross References, study sheet tabs, Lexicon entry, Strong's toggle, KJVA⇄LXX, Compare + its menu, passage picker typed range, chapter arrows, Find in Chapter, Reading Options/Scripture Display, Add Note (Markdown + auto-link), Notes home/search/swipe-delete/Trash/permanent delete, tab switcher, daily note deep link, Settings (Reading, About), dock More menu. Earlier today (CC-01/02/04): Search order/grouping/collapse/result round trip, Messages folders/reply quote.
- **Mac (AX/PID only):** main window, full menu bar, Settings → Reading, Strong's, Study panel, toolbar/sidebar accessibility. Earlier today: Search order/collapse, Messages folders/quote.
- **Pass 2 (iPhone):** Study Trail list and trail screen (A32), Study Tools menu, Calendar (A33/A34), PDFs empty state, dark mode + largest accessibility text on the reader (text scales, readable; top bar fixed-size — acceptable).
- **Pass 3 additions:** Mac workspace menu (complete; Delete correctly disabled with one workspace), Getting Started on Mac.
- **Verified in earlier sessions, not re-run:** Notes Board/slash menu/tables/images (Nov 22 HANDOFF entries), YouTube tab + manual PiP (Nov 20/22), Messages (CC-04).
- **Not yet covered (next):** YouTube tab and PiP; PDF import/highlights/bookmarks (library is empty on this sim); Study Trail recording/merge/split; (Presenter and History checked on Mac — A35/A36; Tags and Ask Berean on iPhone — A37/A38; Mac keyboard flows ⌘K / ⌘T+Esc / ⌘[ / ⌘] all work); workspaces (create/rename/switch); Notes Board, slash menu, tables, images, version history; e-Sword/Markdown import; idioms; Ask Berean; App Intents/Spotlight; iPhone landscape/Dynamic Type/dark mode; Mac window resizing and multiple windows; keyboard-only Mac flows.

## Data touched

iPhone E8B: one audit note created then permanently deleted; John 3:4/3:6 yellow highlights created then deleted; a daily note opened and left empty — **it was persisted** (see A33); removed afterwards; Strong's toggled back off; a test tab opened and closed. Mac QA (claude-20261120): Strong's and Study panel toggled back; no content written. No production data, D0CC, Codex QA library or physical phone.

## Suggested fix order

1. **S2:** A4 (Lexicon segment under grab handle), A14 (permanent delete without confirmation), A18 (deep link under presented sheet), A28 (Mac Study panel overlaps verse 1).
2. **S3:** A2 (black highlight swatches), A3 ("Native Dev" label), A8/A30 (Strong's binding), A9 (Compare bar spacing), A12 (Add Note return path), A15 (Trash restore discoverability), A19/A29 (accessibility labels), A21 (iPhone library path), A22/A24 (Mac app name, system window tabs), A7/A27 (scope decisions).
3. **S4:** the rest.

## Fix status

| # | Status | Where |
|---|---|---|
| A4 | **Fixed, verified on iPhone sim** — Lexicon centre tap selects the tab; sheet no longer jumps. | `native/claude-audit-fixes-20261126` @ `691c9aa5` (StudyInspector.swift) |
| A14 | **Fixed, verified on iPhone sim** — context-menu and swipe Delete Permanently both confirm ("This can't be undone."); purge/Empty Trash errors reported. | same branch (NotesHome.swift) |
| A18 | **Fixed, verified on iPhone sim** — with the Tabs sheet open, `berean-native-dev://daily` closes the sheet and the note opens in front. | same branch (BereanIOSApp.swift, IOSRootView.swift) |
| A5, A16, A20, A21, A24, A25, A26 | **Fixed** — lexicon trim (verified on iPhone G1080); "1 note"; no repeated section headers (verified Mac Settings); iPhone library "On this iPhone"; Mac window tabbing off and Help → Getting Started (verified Mac menus); Word Replacer switch. | same branch @ `2501c66f` |
| A2, A3, A8 | **Fixed by Codex** (app source c3676b9b, per the Nov 26 pre-8pm checkpoint): native coloured swatches + conditional Remove Highlights, "Copy Links" wording, Strong's word joins. | reader-notes |
| A23 | Left as design choice — the Go menu's first "YouTube" opens a YouTube tab, the second (⌘4) switches to the YouTube space; rename one (e.g. "YouTube Space") if wanted. | owner/Codex |
| A32 | **Fixed, verified on iPhone sim** — inline title; "Feasts trail" visible (cause: large title under the pinned top search inset). | same branch @ `c637f9a1` (StudyTrailView.swift) |
| A38 | **Fixed, verified on iPhone sim** — keyboard dismisses on ask, examples hidden after the first question; answer fully visible. | same branch @ `39d0bb2e` (AskBereanView.swift) |
| A37 | Hint fixed (names "Tag Selected Verses…"); missing title is the List/Graph picker occupying the title slot — left as design. | same branch @ `39d0bb2e` (TagManagerView.swift) |
| A31 | **Fixed, verified on Mac** — checklist hint wraps to two lines. | same branch @ `e646fa2a` (GettingStartedChecklist.swift) |
| A12 | **Fixed (CC-08), verified on iPhone sim** — Add Note edits inside the verse sheet; no new tab; Back/Done return to the same reader. | same branch @ `f5bb1d40` (ScriptureView.swift) |
| A15 | **Fixed (CC-07)** — visible Restore per row; no compose in Trash. | same branch |
| A39 | **Fixed, verified on iPhone sim** — native `NoteFinalize` port + leave hook; abandoned untitled note trashed, titled note kept. | same branch @ `044f0148` (NoteFinalize.swift, NotesViews.swift) |
| A35 | **Fixed, verified on Mac** — Presenter scroll content gets a top margin so the heading / followed verse never sit under the title bar (it was not caused by the main reader after all: still present with Codex's A28 fix merged). | same branch @ `cb4e6de3` (PresenterView.swift) |
| A28 | **Fixed by Codex** (c3676b9b): settled Mac chapter openings stay below the toolbar through repeated Study-panel toggles. The Presenter case was separate (A35, fixed above). | reader-notes |

Both native builds pass on the fix branch; test fixtures (one note, two tabs) removed afterwards.

### Codex integration checkpoint

The listed Claude fixes are integrated in `90171b62`. A2, A3, A8/A30, A22 and A28 have subsequent Codex working changes. See the [integration review](INTEGRATION-REVIEW-2026-11-26.md) for verified cases, candidate scope and outstanding retests. A32 and A15 are ready Claude assignments after the scheduled handoff. [Work queue](AI-WORK-QUEUE.md)

### Codex source correction to A34

`openCalendar()` already delegates to `openUtilityTab(newTab: false)` and reuses an existing Calendar in the current workspace. Opening the first one creates a tab; repeated opens are designed to focus it. A repeated-open runtime check is still needed, so do not implement a second reuse layer based on the audit wording alone. The missing iPhone Study Tools History route is being added using the same existing utility-tab path.

### Final Codex runtime follow-through

All-visible Find is implemented in c7338cb3 with actor isolation correction536ed1b9. Both full app builds passed; Mac Romans8 Spirit22matches and iPhone Matthew5 blessed9matches showed faint inactive and orange active marks. Stepping, no-match/query replacement, close and iPhone chapter change cleared old paint; existing Mac blue ROM8:1–2 highlights were visually retained. iPhone History is present and opens from Study Tools. Repeated History and Calendar each kept ten tabs after the initial nine→ten creation; owned utility tabs were closed and all original nine tabs restored. A34 duplicate-Calendar claim is therefore contradicted by runtime. A33 is intentional original behavior, as the source reconciliation explains. General menu accessibility, other external-route covers and the wider matrix remain open.

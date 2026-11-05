# 07 - iOS native architecture (proposal)

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit of commit `807c2d974b795f95f4c05b8ae4b6796c273b572c` (package.json 0.8.1, iOS `CURRENT_PROJECT_VERSION = 7`), `/Users/roywe/Berean-audit`, read-only, 2026-11-05. Proposes a native Swift iPhone app. It does not authorise implementation. It is deliberately **not** a port of the desktop: the iPhone app already has its own navigation model (`src/mobile`, 17,014 non-test lines in 137 files, 02 section 8.2) and that model, not the desktop's, is the reference. Companion documents: 02, 03, 06 (macOS), 08 (shared Swift).

Evidence labels: **VERIFIED** (read in code or returned by Apple documentation during this audit), **INFERRED**, **UNVERIFIED**, **BLOCKED** (no builds, no device, no database reads, no simulator per the audit rules). Apple documentation was queried through Xcode's documentation index; it returns symbol descriptions but **not** OS availability, so every "requires iOS N" claim is UNVERIFIED.

A `WKWebView` hosting React/ProseMirror is not native. Where a web island is unavoidable (YouTube) it is named as such in section 13.

---

## 1. Summary

1. **Target model:** one `UITabBar`-less, card-based navigation: a persistent three-control bar (Tab cards, Plus/Quick Open, Caret), per-tab history, sheets that are navigable surfaces. This model is documented and tested by the author's 2026-09 device-testing waves (`docs/mobile/mobile-navigation.md`, `docs/navigation-contract.md`, `docs/ux-principles.md`). It should be carried over as **behaviour**, not re-derived from SwiftUI defaults. A stock `TabView` + `NavigationStack` app would silently lose most of it.
2. **SwiftUI is the right default for iOS chrome and lists; UIKit (TextKit 2 `UITextView`, `UIPageViewController`/`UICollectionView`, `UIGestureRecognizer`) is required for the Scripture reader, the chapter pager and the edge-back gesture.** SwiftUI does not give per-range hit testing, selection-to-offset mapping, or gesture-failure requirements (INFERRED; the UIKit APIs below are VERIFIED to exist).
3. **The highest-risk item is still the notes editor.** No Apple component covers callouts, columns, threads, tables with a private markdown round-trip (03 N02). `TextEditor(text: AttributedString, selection:)` exists (VERIFIED) but is a rich-text editor, not a block editor. Recommended approach: a block-model editor on a markdown AST with native text views per block (section 9), gated by a round-trip corpus. A temporary hosted ProseMirror is possible but is explicitly not native.
4. **Reuse architecture, not Mac code.** Most of the iPhone's value is in the shared domain/data layer (08). The iOS-specific interface layer is a thin set of UIKit/SwiftUI views over it.
5. **No capability may be silently dropped.** Section 14 is a ledger of every iPhone behaviour found in `src/mobile` and each one's proposed native fate (keep, adapt, replace by system behaviour, or explicit decision needed).
6. **Memory and background constraints are the main non-UI risk:** Kokoro ONNX inference in-process (`BereanVoicePackPlugin`) and 19 bundled text databases plus a 7 MB YouTube index (VERIFIED sizes in 14 section 2.6) run under iOS jetsam limits that were never measured on device (BLOCKED).

---

## 2. Current iPhone architecture, the facts that constrain the proposal

All VERIFIED.

- Capacitor 8 `WKWebView` shell; `BereanBridgeViewController` registers 14 first-party Swift plugins (02 section 2.5, 13.2). iPhone only (`TARGETED_DEVICE_FAMILY = 1`), iOS 17.0 deployment target (`IPHONEOS_DEPLOYMENT_TARGET = 17.0` in `project.pbxproj`), single scene (`UIApplicationSupportsMultipleScenes = false`), Swift 5.0 language mode.
- Orientations declared for iPhone: portrait, landscape left/right (Info.plist `UISupportedInterfaceOrientations`). Whether the web layout is usable in landscape is UNVERIFIED.
- `UIBackgroundModes = audio` only.
- Targets: `App`, `ShareExtension` (96 lines), `BereanWidget` (129 lines, static launcher), App Intents file `BereanIntents.swift` (103 lines).
- **App Intents (correction to 03 A05):** 03 says "no `AppShortcutsProvider` seen in the portion read (UNVERIFIED)". It exists: `struct BereanShortcuts: AppShortcutsProvider` at `ios/App/App/BereanIntents.swift:95`, and five intents (`OpenScriptureIntent`, `SearchBereanIntent`, `OpenDailyNoteIntent`, `StartReadAloudIntent`, `OpenWorkspaceIntent`). All use `openAppWhenRun = true` and hand a `<scheme>://route` URL to `UIApplication.shared.open` (VERIFIED).
- Data: `berean.db` in Application Support with `PRAGMA journal_mode = WAL` and `foreign_keys = ON` set by `BereanSQLitePlugin.swift:113-114` (VERIFIED), bundled read-only DBs in `App.app/data` (24 in `scripts/ios/bundled-dbs.txt`), PDFs in `Library/Berean/pdfs`, App Group inbox for the Share Extension, iCloud container through `NSFileCoordinator` + `NSMetadataQuery` (`BereanCloudPlugin.swift`).
- The iPhone embeds desktop components directly: `BiblePanel`, `LexiconPanel`, `YouTubeTab`, `PDFViewer`, `TagsGraphPanel`, the ProseMirror editor, settings sections, Study Trail views (02 section 8.2). Hence "iPhone behaviour" is partly desktop code in a touch wrapper; the **mobile shell** (`MobileApp.tsx`, 555 lines, `NavigationStack`, `BottomNav`, `SheetHost`, `TabCardsSheet`, `NewTabSheet`, `ChatOverlayHost`, `AudioBar`) is the native-relevant specification.

---

## 3. Navigation architecture

### 3.1 The model to preserve (VERIFIED, `docs/mobile/mobile-navigation.md`)

Three persistent controls on every tab type: **Tab cards** (bottom left), **Plus** (bottom centre), **Caret** (bottom right); a horizontal swipe across the bar steps to the previous/next tab of the workspace; the bar hides while the keyboard is up, collapses on scroll in Scripture/Compare, and verse sheets at low position cover it (TEST-039). Navigation is expressed as `openDestination(destination, intent)` with intents `current-tab`, `new-tab`, `existing-tab`, `reuse` (Quick Open) and presentations (`sheet`/`overlay`) that never touch tabs until the user picks (`src/lib/navigation/destination.ts`, `tabResolution.ts`). Destinations: `passage`, `note`, `strongs`, `search`, `video`.

### 3.2 Proposed native structure

```
BereanApp (SwiftUI @main, UIApplicationDelegateAdaptor for URL/Spotlight/intents hand-off)
  RootScene
    TabContentHost                      // shows the active tab's page
      per tab: NavigationStack(path: tab.pushedPages)   // ONLY pushed pages (settings sub-pages, versions, ...)
    FloatingControls (overlay)          // TabCards | Plus | Caret   (custom, not UITabBar)
    SheetCoordinator                    // one source of truth for plus / caret / tab cards / verse sheet / audio sheet
    AudioBar / FloatingPlayPause
```

Rationale and constraints:

- **Do not use `TabView`/`UITabBarController` as the primary navigation.** The model has an unbounded number of tabs of mixed types, per-tab history and sessions; `UITabBar` expects a small fixed set of destinations (INFERRED). A custom floating control row over a `TabContentHost` is what the web app already is. iOS 26 tab-bar/Liquid Glass bottom accessory affordances might approximate parts of it; UNVERIFIED, needs a spike before it is dismissed.
- **Per-tab history is state restoration, not a view stack.** `tabNavStacks` entries carry `state` snapshots and `home` steps; `restoreTabNavEntry` is "the single restore path for back and forward" (mobile-navigation.md section 8). That is a model with snapshots (Scripture: text, passage, verse, scroll, Compare on/off; Notes: list/folder/filter and each note; Search: query/scope/filters and scroll; Settings: section). Therefore each tab's `NavigationStack` path should contain only genuinely pushed pages; the tab's own back/forward walks `TabNavEntry` snapshots in the shared navigation module (port of `src/lib/navigation/*` + the tab slice of `src/store/index.ts`) and re-renders the same page. Making history a `NavigationPath` would conflate two concepts and lose "‹ returns to previous type" semantics (`transformTab`: the tab changes type in the same slot, history carried).
- **`transformTab` ("this tab becomes another type")** is a model operation; the host swaps the page under the same tab identity with a cross-fade. Native navigation transitions must not imply a new tab.
- **Sheets are navigable surfaces:** "Tab cards -> Tab -> Caret -> current Sheet -> sub-view in the same sheet -> back" (mobile-navigation.md section 5, `Sheet.push`/`pop`/`popToRoot`, "‹ Scripture" back labels). Native: a single `.sheet` per coordinator with an internal `NavigationStack` inside it, `presentationDetents`, `presentationDragIndicator`, `presentationBackgroundInteraction(.enabled(upThrough:))` (VERIFIED APIs: `presentationDetents(_:selection:)`, `PresentationBackgroundInteraction.enabled(upThrough:)`, `presentationContentInteraction`). No second sheet is stacked (T23-006/012/019) so only one `.sheet(item:)` binding exists in the whole app; sub-views push inside it.

### 3.3 Sheet gesture hand-off

The web code reimplements `UISheetPresentationController` scrolling behaviour by hand (`src/mobile/primitives/sheetGesture.ts`, header: "modelled on UISheetPresentationController"; `sheetTakesOver`, `followY`, `handsBackToContent`, 5 % rubber band above the highest detent). VERIFIED. A native sheet gives that handoff for free, which is a point where **native removes code and a class of testing-backlog defects** (the 09-23b round: "a drag that moves the sheet owns the whole touch", "below the top detent an upward drag expands first"). Not free: Berean's "caret has no low detent", "a pushed view never changes the detent", and "the half-open Tabs sheet scrolls" rules need verifying against system behaviour (UNVERIFIED), and the verse sheet's compact/expanded states are product behaviour that must be rebuilt as custom detents (`CustomPresentationDetent`, VERIFIED API exists).

---

## 4. Tabs, sessions and workspaces

### 4.1 Tab cards sheet (VERIFIED behaviour, mobile-navigation.md section 1)

Lists every tab of the current workspace, all types, in unified display order (`sessionDisplayOrders`/`reorderTabDisplay`). Each card previews last state (`TabPreview.tsx`): Scripture passage text from the verse anchor, Compare both columns, note title/text, Search query/scope, Lexicon entry, YouTube thumbnail, History latest entries, Settings look. Previews are "lightweight (the tab's own data, cached for the session) - no screenshots". Gestures: tap open; x close; press-and-hold about 0.4 s lifts (haptic), drag reorders, release without dragging opens the tab's actions inside the same sheet; finger moving before the lift scrolls; while pressed nothing underneath can be selected. VoiceOver gets "Actions for ..." with Move earlier/later. Workspace chip, Sessions view, Archived tabs, Move to workspace and New tab all push inside the sheet.

Native mapping:

- `LazyVGrid` of cards in the root of the tab-cards sheet; cards are SwiftUI views driven by `TabPreviewModel` (pure data -> small SwiftUI render of the same text via `AttributedString`, **not** snapshots).
- Reorder: `draggable`/`dropDestination` with `Transferable`, or `onMove` in a `List` layout. The 0.4 s lift-then-actions behaviour is a long-press with `LongPressGesture(minimumDuration: 0.4)` sequenced with `DragGesture`; `UIContextMenuInteraction` with a custom preview is the system alternative, but then "release without dragging shows actions inside the same sheet" becomes a context menu rather than an in-sheet view. **Decision needed:** keep the in-sheet actions (custom) or adopt the system context menu (Mac-convention-like, less code, different feel). Neither is verified on device.
- Fractional order keys and sessions come from the shared `SessionsService` (08).

### 4.2 Sessions, workspaces, archive

The iPhone calls live tab groups "Sessions" (same term as the desktop), snapshots "Saved sessions", and "workspace" in the Tab cards chip (mobile-navigation.md section 7). Data is in `sessions`, `tabs`, `archived_groups`, `session_local_state` (device-local) and the `workspaces` table (`layout_json` is ignored on iPhone; "iPhone ignores mosaic layout (documented)", 03 U05). Native: identical tables, no layout tree on iPhone. `Tab.isPinned` is persisted but never set (03 U03); no pin UI is proposed.

### 4.3 Persistence and restoration

Today: Zustand persisted to localStorage (debounced) **plus** SQLite mirror via `tabPersistenceRuntime.ts` (400 ms), flushed on `pagehide`/background (02 section 7, 11). Native: SQLite is the single source of truth (via the shared service); scene restoration uses `@SceneStorage` only for transient UI (current sheet detent, scroll anchors). The existing "two stores of truth for tab structure" risk (03 U04) disappears if localStorage is retired, but **preference migration** is needed: font size, theme, word-replacer rules, `showStrongs` etc. live in localStorage (`persist` key `berean-app-state`) or the `settings` table (`settingsBridge.ts`), and localStorage inside the WKWebView is not readable from native code without a bridge (03 S11, INFERRED). First native launch must import from the web-app store; mechanism belongs in the coexistence plan (not in 06-08).

---

## 5. Quick Scripture opening (Plus = Quick Open)

VERIFIED behaviour (`navigation-contract.md` section 2-3; memory "Quick Open + tab list", branch `feature/quick-open-tabs`, uncommitted at the memory snapshot; whether it is merged at this commit is UNVERIFIED but the `reuse` intent is documented in the contract at HEAD):

- Plus = one search field ("Search Berean"), scope All / Scripture / Strong's / Notes, a single Filters entry (text, individual books, match), results grouped Go to / Verses / Lexicon / Notes, search as you type (debounced), picks open in a **new** tab with the `reuse` rule (an already-open tab of the current session showing the destination is brought forward; passage identity = text + book + chapter; note id; Strong's number; search query+scope; video id; never switches session; long press -> Open New Copy / Go to Tab in another session / Open in This Tab).
- Empty query: recent searches (shared), one compact row of experiences as new tabs (+More), Recent places.
- The query parser is deterministic (`searchIntent.ts`, `unifiedSearch.ts` in `src/lib/search/`): "Matthew 10", "Matthew 10 LXX", "jubilees 23", "H430", "G26 H430", "lxx love", "enoch: watchers", quoted phrase, "notes ..." (navigation-contract.md section 3).

Native: `SearchSurface` as a SwiftUI view inside the plus sheet; query understanding is the shared `BereanSearch` module (port of `searchIntent.ts` + `unifiedSearch.ts`, 08 section 5). Use `.searchable`? The plus field lives in a sheet and has custom scope/filters; a plain `TextField` with custom results is closer to the current design than `.searchable` (INFERRED). Search tokens (`UISearchToken`) for scope are a native option; UNVERIFIED fit.

Performance expectations: typing must return grouped results per keystroke: Scripture FTS over up to 19 text DBs is a real cost; the web layer debounces. A native version should run FTS on a background connection (actor, 08 section 6) and cancel superseded queries (Swift structured concurrency `Task` cancellation), keeping the main actor free.

---

## 6. Reader, gestures, long-press, selection

### 6.1 Reader architecture (UIKit core)

`ReaderPage` is a horizontal **chapter pager** (previous/current/next) with edge taps; "each accepted swipe moves exactly one chapter"; while a transition settles the track takes no new drag; edge strips are thin so text selection and the verse tap zone are unaffected (`ReaderPage.tsx:46-55,125-162,386-392`, VERIFIED). Compact high-density layout (verse numbers near left edge, ~90 % text width), top bar that hides when reading downward and collapses into a compact pill joined to the Dynamic Island/notch, bottom controls slide away with the same hysteresis, pinch-to-zoom font size with haptic ticks at 12/32 and a transient badge (`usePinchFontSize.ts`, `BIBLE_FONT_MIN = 12`, `BIBLE_FONT_MAX = 32`).

Proposal:

- Pager: `UIPageViewController` (transition style scroll) or a horizontal paging `UICollectionView` whose cells host chapter views; SwiftUI `TabView(.page)` is rejected for this job because chapter views are heavy and the pager must keep exactly three alive (INFERRED).
- Chapter view: one TextKit 2 `UITextView` (read-only, `isEditable = false`, `isSelectable = true`, `isScrollEnabled = true`) per chapter, with the same `VerseTextModel` + `DisplayMap` as macOS (06 section 9; shared in 08). VERIFIED: `UITextView` exposes `textLayoutManager` and `isFindInteractionEnabled`.
- Compare page: two or more columns on macOS; on iPhone "stacked, interleaved verse cells" (03 S13), LXX <-> KJV only (mobile-navigation.md). A `UICollectionView` of paired verse cells; Strong's per column; sync scroll default on.
- Chrome collapse: scroll offset delta drives chrome state (`useChromeScrollCollapse.ts`, `useHideOnScroll.ts`, `chromeState.ts`) -> SwiftUI overlay visibility with the same hysteresis; iOS 26 scroll-edge effects can provide the soft edge (`BereanBridgeViewController` already hides the top edge effect, VERIFIED, 02 section 2.5).
- Pinch: `UIPinchGestureRecognizer` on the text view; apply to the persisted font-size setting through the same clamped setter; haptic via `UIImpactFeedbackGenerator`/`.sensoryFeedback`.
- Dynamic Type: today `BereanA11yPlugin` reports accessibility state to JS (64 lines; content not read in detail). The user font size is an app setting independent of Dynamic Type (INFERRED). Native should scale the app size with `UIFontMetrics` so the system text-size setting still matters; whether to multiply or replace is a product decision.

### 6.2 Tap, long-press, selection (conflict to resolve explicitly)

Current iPhone model (VERIFIED, mobile-navigation.md section 6): **tap adds a verse to the selection, tap a selected verse removes it** (contiguous or not); one verse -> verse sheet study view; several -> same sheet, several-verse view; drag-select from verse numbers; long-press (about 450 ms, `useLongPress.ts`, `delayMs = 450`, cancels after 8 px of movement, suppresses the following click) opens result/verse actions because "iOS WKWebView does not fire `contextmenu` on a press". Strong's tap in the text opens the Strong's sheet; text-range selection offers highlight.

Native text view conflict: `UITextView` gives long-press = begin selection (loupe, handles, edit menu) and tap = clear selection/caret placement. Berean wants tap = verse toggle. Proposed arbitration:

- Single tap recognizer on the text view with `require(toFail:)` against the text interaction's double-tap and long-press gestures (`UITextInteraction.gesturesForFailureRequirements` is VERIFIED to exist in the index) so tap-to-toggle-verse does not break word selection.
- Long press keeps the **system behaviour** (native selection handles, magnifier, Look Up, Copy, Share). This is where "native selection" should replace the custom 450 ms gesture. Berean actions are added to the **edit menu** (`UIEditMenuInteraction`, iOS 16+; INFERRED fit): Highlight (swatch submenu), Add Note, Copy with Reference, Tag, Strong's.
- A verse-level action surface that is not a text selection (the verse sheet) stays tap-driven.
- Selection -> highlight offsets via `DisplayMap` (06 section 9.2). The existing risk "UIKit/AppKit text selection hit-testing differs from DOM; selection-to-offset translation must be re-proven" (03 S07) applies here too.
- Drag-select from verse numbers is a custom pan recognizer that begins on the badge hit zone and extends the verse range; it must not start while the text selection loupe is active.

### 6.3 Edge swipe back (VERIFIED, `src/mobile/navigation/edgeBack.ts`)

On a tab's root page the left-edge swipe: (1) if the tab has an earlier history step, go back one step (same as the caret's `‹`); (2) if at the first step, **close the tab** and activate the most recently used tab; (3) if only one tab is open, nothing. Pushed pages keep their own pop gesture (NavigationStack). Native: `UIScreenEdgePanGestureRecognizer` (left edge) on the host with the three-way logic implemented in the shared navigation module; coexists with (a) the pager's horizontal pan (edge zone is the discriminator, as the web already does), (b) sheet dismissal, (c) `NavigationStack` interactive pop on pushed pages. This gesture is **not** the system default and a native rewrite must not "simplify" it to NavigationStack back: that would lose rule 2 (close tab on root). Needs on-device testing (BLOCKED).

### 6.4 Other gestures to carry over

Swipe to reply in Berean Chat (`useSwipeToReply.ts`), swipe across the bottom bar to step tabs, pull-to-dismiss on sheets (`useSwipeDismissGesture`), pinch/pan on the tag graph (code in `MobileApp.tsx`), press-hold-drag on tab cards, keyboard-dismiss behaviours (`keyboardDismiss.ts`: search results dismiss the keyboard while scrolling, "Search fields never force capitalization", mobile-navigation.md section 10). Each is a small, independent UIKit/SwiftUI gesture module.

---

## 7. Context menus and action sheets

The web layer has a **custom `ActionSheet`, `PopoverMenu` and `anchoredMenu`** (`src/mobile/primitives/`) because WKWebView lacks native menus. Native replacements:

| Current | Native |
|---|---|
| Verse action sheet / selection bar / multi-verse sheet | The verse sheet (custom detent sheet, section 3.3), plus the edit menu on selection |
| Result long-press menu (`ResultActionSheet`, `resultActions.ts`) | `.contextMenu(menuItems:preview:)` / `UIContextMenuInteraction` with the same two intents (Open in New Tab / Open in This Tab) |
| Tab card actions | in-sheet actions or context menu (decision in 4.1) |
| Note list item actions | `.contextMenu` + `.swipeActions` (INFERRED better fit than current) |
| Caret command registry (`caretRegistry`, `CaretSheet`) | **Custom** (see 8); not a system menu because it holds inline steppers/segmented controls that keep the sheet open |
| Popover menus | `Menu`, `confirmationDialog` |

---

## 8. Caret = per-page command surface (custom, keep)

VERIFIED design: `caretRegistry` holds registrations from mounted pages, "the most recently mounted page wins" (a pushed note editor takes over and hands back on pop), pages register via `useCaretCommands(() => scope)`, builders read lazily at open; a scope is `{title, subtitle?, sections[]}` of `tiles` and titled rows; commands are action/toggle/stepper/segmented; inline controls keep the caret open; kind `view` pushes a sub-scope inside the sheet; every caret opens with a location field plus ‹ › stepping the current tab's history (`CaretGoTo`).

Native: a `CommandScope` protocol in the shared UI kit and an environment-provided registry (`@Environment(\.commandRegistry)`), with pages declaring `.commandScope { ... }` view modifiers; lifetime is tied to view appearance, giving the same "latest mounted wins" semantics through a stack. This is an area where SwiftUI's declarative preferences (`PreferenceKey`) fit naturally (INFERRED). The caret tile/row layouts per context (Scripture, Compare, Notes list, Note editor, Search, Lexicon, YouTube, PDF, Tags graph, More) are in mobile-navigation.md section 3 and must be re-specified as data, not code.

---

## 9. Notes editing

### 9.1 What exists (VERIFIED, 03 N02-N08, N11, mobile-navigation.md section 9)

Markdown stored in `notes.content`; ProseMirror schema with doc, paragraph (indent attr stored as NBSP run), blockquote, callout (`> [!NOTE]`), column_list/column, thread/thread_entry, horizontal_rule, study_trail_embed, heading, code_block, image, hard_break, bullet_list (marker attr), ordered_list, list_item (checked), tables; marks em, strong, code, strike, underline, highlight(color), link, wikilink. iPhone editor: no permanent format bar; selection bubble (`PhoneSelectionToolbar`), markdown mode, floating "+" for inserts (`NoteInsertButton`, `noteInsertCommands`), autosave 500 ms (`useNoteAutosave.ts`, `SAVE_DEBOUNCE_MS = 500`) with an explicit race fix (`TEST25-NOTES-001`: "the editor is never fed its own saves"), version snapshot after two idle minutes, verse autocomplete, wikilinks, slash commands, heading collapse persisted per note.

### 9.2 Options

| Option | Description | Strengths | Weaknesses |
|---|---|---|---|
| A | Block-model editor: markdown -> AST (swift-markdown plus custom extensions) -> block view models; each text block a native text view; tables, columns, threads, callouts as native container views | Round-trip is a model concern (blocks serialise independently); custom blocks are first-class; native IME/dictation/autocorrect per block | Cross-block selection and copy/paste, undo across blocks, accessibility rotor, and drag handles must be built; large effort |
| B | One TextKit 2 `UITextView`/`NSTextView` with attachments (`NSTextAttachmentViewProvider`) for tables/columns | Native cross-block selection and undo | Tables/columns as attachments are weak (INFERRED); markdown round-trip from attributed text is lossy; threads/columns hard |
| C | SwiftUI `TextEditor(text: AttributedString, selection:)` | Least code; system formatting menu (VERIFIED: `TextEditor` shows system formatting controls and `textInputFormattingControlVisibility`) | No block types; `AttributedString` richness is limited to its attribute scopes (INFERRED); cannot represent callout/columns/threads; OS availability UNVERIFIED |
| D | Keep ProseMirror in `WKWebView` | Zero fidelity risk, ships | **Not native**; stays a web island forever; `TEST25-NOTES-001`-class races remain |

**Recommendation:** A, built behind a conformance corpus, with D as a time-boxed *transition* only (and labelled as such in any plan). Acceptance criteria that do not exist today and must be created: (1) parse and re-serialise the author's 3,375 notes (per the perf doc; BLOCKED here) byte-identically or with a documented normalisation; (2) all existing `pm/__tests__` round-trip fixtures (40 files incl. `roundtrip.test.ts`, `trailingSpaceRoundTrip.test.ts`, `schema.imageWidth.test.ts`, `threads.test.ts`, `columns.test.ts`; 03 N02) pass as golden JSON; (3) IME, dictation, autocorrect and undo sessions on device; (4) VoiceOver can move block-to-block.

Notes: the markdown dialect (underline, highlight colour emoji, columns, threads, NBSP indent) is "private to Berean/vault dialect" (03 N02), so an off-the-shelf CommonMark/GFM parser handles only part of it; the extension rules must be specified from `markdownIt.ts`/`serializer.ts` (not read in detail by this audit).

---

## 10. Search, keyboard, find

- **Global search:** section 5. **Per-tab Search tab:** results virtualised (`@tanstack/react-virtual` today) -> `LazyVStack`/`UICollectionView` with incremental limit (`useIncrementalLimit.ts`).
- **Find in chapter** (`FindOnPage.tsx`, `PhoneFindBar.tsx`): matches the raw OR displayed (word-replaced) text, phrase/all/any, number-word alternates (`src/lib/scriptureFind.ts`). Native: `UIFindInteraction` with a custom `UITextSearching` object over the display string. VERIFIED in documentation: `UITextView.isFindInteractionEnabled`, `UIFindInteraction` ("Input from a hardware keyboard triggers... Command+F, Command+G, Command+Shift+G"), `UITextSearching` with `decorate(foundTextRange:...)`, `clearAllDecoratedFoundText()`, `scrollRangeToVisible`, `UITextSearchingFindSession`. Result: the system find panel UI plus Berean matching semantics. `PDFView` and `WKWebView` also support built-in find interactions (documentation text).
- **Keyboard:** the tab/plus/caret bar hides while the keyboard is up (VERIFIED). Hardware-keyboard shortcuts are "NOT STARTED" per the feature matrix (03 U09/U10); iPad is not a target. Proposed minimum for hardware keyboards on iPhone: `.keyboardShortcut` for Search, New Tab, Next/Previous Chapter, Back (INFERRED value; none required).
- **Keyboard avoidance and sheets:** `Keyboard.resize none` in `capacitor.config.ts` (VERIFIED) means the web code positions around the keyboard itself (`keyboard.ts`, `safeArea.ts`); native SwiftUI/UIKit handle safe area and keyboard layout guides.

---

## 11. Audio, Read Aloud, Now Playing, background

VERIFIED current design (03 M05-M09, `src/platform/ios/voicePack.ts`, `src/mobile/audio/*`, `BereanAudioPlugin`, `BereanSpeechPlugin`, `BereanVoicePackPlugin`):

- Two backends: curated Apple voices (`AVSpeechSynthesizer`, with `boundary` events carrying character offsets) and Kokoro-82M (ONNX q8) synthesised natively by `BereanVoicePackPlugin.synthesize` using `onnxruntime-swift-package-manager` exact 1.24.2. Phonemisation and tokenisation still happen in **JavaScript** (`voicePack.ts` ~line 79 computes ids/style tensors; 03 M05 item 3); a native port needs an equivalent G2P (espeak-ng/misaki class), which is **new work** and the blocker for removing JS (03 M05 item 9).
- Word-follow highlighting is **estimated** by distributing each chunk's real audio duration over characters (`timestampAlignment.ts`: Kokoro exposes no alignment), Apple voices use boundary callbacks.
- Playback: `.playback` audio session category, `UIBackgroundModes: audio`, lock-screen Now Playing and remote commands (`BereanAudio` plugin: `activateSession`, `setNowPlaying`, `clearNowPlaying`; remote `command` events play/pause/toggle/next/previous/stop), queue and saved playlists with 800 ms debounced autosave (`useQueueAutosave.ts`), sleep timer (`sleepTimer.ts`, presets, undocumented), auto-advance chapters.
- Voice pack: sequential file download to `Application Support/Berean/tts-models` with a background task, manifest written last (`BereanVoicePackPlugin`), independent of `BereanDownloads` (SHA-256 verified; used for transcript packs). 03 M08 notes the voice-pack path has no SHA check (INFERRED).

Native proposal:

- `AudioEngine` actor owning `AVAudioEngine` + `AVAudioPlayerNode` (or `AVAudioPlayer` for cached WAV); `MPNowPlayingInfoCenter` and `MPRemoteCommandCenter` replace the Capacitor plugin 1:1; interruption and route-change observers (`AVAudioSession.interruptionNotification`) are required and were handled in the plugin (INFERRED; not read in detail).
- Synthesis behind a `SpeechSynthesizing` protocol with two implementations (Apple voices, Kokoro/ONNX); G2P as a separate protocol so it can be developed independently (08 section 5, module `BereanSpeech`).
- Word follow: use `AVSpeechSynthesizerDelegate.speechSynthesizer(_:willSpeakRangeOfSpeechString:utterance:)` for Apple voices (INFERRED API) and the same proportional estimate for Kokoro, driving the same rendering-attribute highlight as the reader (06 section 9.5).
- **Memory:** ONNX Runtime plus a model of the Kokoro-82M class is held in memory only while speaking in the plugin (`unload` method exists, 02 section 13.2). Peak resident size and jetsam behaviour on a real device were never measured (BLOCKED, 03 M05). A native design should keep `unload` semantics, release the session on `UIApplication.didReceiveMemoryWarningNotification` and measure before shipping.
- Low Power Mode and thermal state already feed the app (`BereanPower` plugin, `getResourceMode`; Mac `powerAwareness.ts`): `ProcessInfo.isLowPowerModeEnabled` and `ProcessInfo.thermalState` replace the plugin; sync and YouTube refresh throttling hang off the same signal (02 section 11).

---

## 12. Share Extension, Spotlight, App Intents, widget, deep links

| Surface | Current (VERIFIED) | Native fate |
|---|---|---|
| Share Extension (`ShareViewController.swift`, 96 lines) | Already native Swift. Collects text/URL/PDF items into the App Group inbox, then opens `<scheme>://share`; identity from Info.plist `BereanAppGroup`, `BereanURLScheme`; app side `BereanShareInboxPlugin` (`take`, `readFile`, `ack`) + `shareInbox.ts` drains on `visibilitychange` | **Keep as is**; move the inbox reader into a shared Swift module (`ShareInbox`); the web `visibilitychange` becomes `scenePhase == .active` |
| Spotlight (`BereanSpotlightPlugin.swift`, 70 lines; `spotlight.ts`) | Indexes notes, tab sessions, saved workspaces, books + chapters of the default translation (not verses); item identifier = deep link URL; full index once per launch then incremental on `data:changed` (debounced); chunks of 250 | `CSSearchableIndex` from a `SpotlightIndexer` actor observing the database change feed; consider `IndexedEntity`/App Entities (App Intents) so Spotlight results and Siri share one entity model (INFERRED, UNVERIFIED availability) |
| App Intents (`BereanIntents.swift`) | 5 intents, `openAppWhenRun = true`, URL hand-off, plus `BereanShortcuts: AppShortcutsProvider` | Port as an **App Intents package** shared by iOS and macOS; call the navigation module directly through an `@Dependency` instead of re-routing through a URL where the app is already running; deep link remains the cold-start path. Add `AppEntity` for notes/workspaces if Siri/Shortcuts parameter resolution is wanted |
| Widget (`BereanChatWidget.swift`, 129 lines) | Static launcher "New Message" to `<scheme>://chat/new`, no data timeline | Keep (already SwiftUI/WidgetKit); optional later: Daily-note/Verse-of-the-day with an App Group read |
| Deep links | `berean://` routes: verse, open, note, lexicon, video, pdf (+ legacy `berean-pdf://`), search, trail, daily, share, workspace, session, chat[/new], `&play=1`; cold-start queue and 1.5 s de-duplication (`deepLinks.ts` `DEDUPE_MS = 1500`); Universal Links not implemented | `onOpenURL` + `NSUserActivity` continuation; **grammar is a permanent contract** (links live inside users' notes); port `src/lib/deepLinks.ts` (223 lines) with its tests as golden cases (08 section 11) |

The Berean Dev identity (separate bundle ID, App Group, container, URL scheme) must stay (project rule: iOS device testing is always Berean Dev). `config/app-identity.json` + generated xcconfigs carry over to the native project (08 section 10).

---

## 13. YouTube, PDF, PiP on iPhone

**YouTube:** web island. Today `BereanWebViewPlugin` creates a native `WKWebView` overlay (open, setRect, show, hide, command, close) loading the embed from an https base because the embed refuses the `capacitor://` origin (03 M01). In a native app it remains a `WKWebView` (or `YouTubePlayer`-style iframe host) with native chrome; the Capacitor-era origin issue disappears but the embed still needs an https base URL (INFERRED). PiP: system PiP only from the native player's fullscreen controls; WebKit blocks programmatic PiP without a user gesture (the iPhone doc says so, 03 M02); `AVPictureInPictureController` is not usable without a stream URL. State this limit plainly in any native plan. Transcript packs: per-channel resumable downloads, SHA-256 verified (`BereanDownloadsPlugin`) -> `URLSession` background configuration; FTS5 merge on arrival (`youtubeIndexMerge.ts`, 81 lines).

**PDF:** PDFKit `PDFView` (UIFindInteraction already supports it, VERIFIED text). Import through `.fileImporter`, the Share Extension and "Open in...". Highlights are DB rows (`rects_json` normalised to page), see 06 section 13.1 for the coordinate-conversion risk. The PDF library is behind `pdfFeatureEnabled` (Settings -> Experimental), with a documented partial gating inconsistency (03 U17).

---

## 14. Ledger: nothing silently lost (every `src/mobile` capability and its proposed fate)

Status key: KEEP (re-implement same behaviour), SYSTEM (system component replaces custom code), ADAPT (re-designed for native but same intent), DECIDE (product decision required), DROP-CANDIDATE (found dead or unused).

| # | Capability (source) | Fate |
|---|---|---|
| 1 | Three persistent controls; swipe across bar steps tabs (`BottomNav.tsx`) | KEEP |
| 2 | Bar hides with keyboard; collapses on scroll (`chromeState.ts`, `useChromeScrollCollapse.ts`) | KEEP |
| 3 | Tab cards sheet with previews, long-press-drag reorder, in-sheet actions, workspace chip, Sessions, Archived, New tab (`TabCardsSheet.tsx`, `TabPreview.tsx`, `SessionSwitcher.tsx`, `ArchivePage.tsx`, `WorkspacesPage.tsx`) | KEEP + DECIDE (in-sheet actions vs context menu) |
| 4 | Plus = Quick Open with `reuse` intent, recents, experiences row, long-press alternates (`NewTabSheet.tsx`, `openTabs.tsx`, `tabResolution.ts`) | KEEP |
| 5 | Caret command registry and location field with per-tab history `‹ ›` (`caretRegistry.ts`, `CaretSheet.tsx`, `CaretGoTo.tsx`, `staticCommands.ts`) | KEEP |
| 6 | Sheets as navigable surfaces (push/pop/popToRoot), detents, scroll/drag hand-off (`Sheet.tsx`, `sheetGesture.ts`) | SYSTEM for hand-off; KEEP for push-in-sheet semantics |
| 7 | Top-left tab-type switcher with `transformTab` and "‹ returns" (`TabTypeSwitcher.tsx`) | KEEP |
| 8 | Edge swipe back: history -> close tab -> none (`edgeBack.ts`) | KEEP (custom gesture, not NavigationStack) |
| 9 | Chapter pager, edge taps, one chapter per swipe (`ReaderPage.tsx`) | KEEP (UIKit pager) |
| 10 | Reader chrome pill joined to Dynamic Island, soft bottom edge (`CompactPassageHeader.tsx`, `mobile.css`) | ADAPT (scroll-edge effects / safe area) |
| 11 | Pinch font size 12-32 with haptics and badge (`usePinchFontSize.ts`) | KEEP |
| 12 | Tap-to-toggle verse selection, multi-verse sheet, drag-select from numbers (`VerseStudy.tsx`, `SelectionBar.tsx`, `MultiVerseSheet.tsx`) | KEEP (arbitrate with native selection, 6.2) |
| 13 | Long-press 450 ms for actions (`useLongPress.ts`) | SYSTEM (context menu / edit menu) |
| 14 | Verse sheet: compact/expanded, Notes in place, Strong's brief/full mode memory, Refs, Copy, colours (`VerseActionSheet.tsx`, `VerseNotesSheet.tsx`, `StrongsSheet.tsx`, `CrossRefsSheet.tsx`, `TagPickerSheet.tsx`, `verseSheetMode.ts`) | KEEP (custom detents) |
| 15 | Compare page, stacked/interleaved, sync scroll, swap sides, LXX<->KJV only (`ComparePage.tsx`, `compareState.ts`, `compareInteraction.tsx`) | KEEP |
| 16 | Passage picker: Library -> collection -> book -> chapter -> verse in one sheet, search understands "LXX" and references (`PassagePicker.tsx`, `ReferencePicker.tsx`, `PickerSearchResults.tsx`) | KEEP |
| 17 | Find on page (`FindOnPage.tsx`, `PhoneFindBar.tsx`) | SYSTEM (`UIFindInteraction`) with custom matcher |
| 18 | Notes home: folders home, Today, Edit, list/gallery layout, sort, group by, filter chips -> caret, floating Search Notes + compose, folder picker, trash (`NotesHomePage.tsx`, `notesHomeModel.ts`, `FolderPicker.tsx`, `TrashPage.tsx`, `VirtualNoteList.tsx`, `noteGrouping.ts`) | KEEP |
| 19 | Note editor page, selection bubble, floating insert, autosave 500 ms, versions, pin/status/icon, print/PDF/share, note peek (`NoteEditorPage.tsx`, `PhoneSelectionToolbar.tsx`, `NotePeek.tsx`) | KEEP (editor per section 9) |
| 20 | Search surface with scope + Filters sub-views (Text, Books, Verse tags), history, grouped results (`SearchSurface.tsx`, `UnifiedResults.tsx`, `BooksFilterView.tsx`, `searchFilters.ts`, `searchHistory.ts`) | KEEP |
| 21 | Calendar overlay and Calendar tab, Today semantics, long-press opens overlay (`calendar/*`) | KEEP |
| 22 | History tab/page, Study Trail pages (Map, Threads, sessions, notes, tags) (`history/HistoryPage.tsx`, `trail/*`) | KEEP (Study Trail is a hosted desktop view today; a native Canvas port is a large item, 03 U14 difficulty High) |
| 23 | Berean Chat page and overlay, find in conversation, swipe-to-reply, Home Screen widget, `AskOptionsPage` (`chat/*`, `ChatOverlayHost`) | KEEP |
| 24 | Settings pages incl. iCloud, Data, Audio, YouTube, Notes, Ask Berean, Experimental, Word replacer, theme preset page (`settings/*`) | KEEP (`Form`) |
| 25 | Onboarding 4-page flow incl. iCloud opt-in (`onboarding/OnboardingFlow.tsx`) | KEEP |
| 26 | Audio bar, audio sheet, queue page, Get Voices view, sleep timer, follow state (`audio/*`) | KEEP |
| 27 | Transcript packs page and downloads (`youtube/TranscriptPacksPage.tsx`, `transcriptPacks.ts`) | KEEP |
| 28 | Native YouTube overlay with rect tracking (`BereanWebViewPlugin`) | ADAPT (no overlay needed; embed directly in the view hierarchy) |
| 29 | Haptics (`haptics.ts`) | SYSTEM (`.sensoryFeedback`/UIKit generators) |
| 30 | Safe-area/keyboard helpers (`safeArea.ts`, `keyboardDismiss.ts`, `sheetEditingGuards.ts`) | SYSTEM |
| 31 | Reading prefs: width, scripture theme, colour presets (38 + custom), Strong's, red letter, verse numbers, continuous scroll (`readerWidth.ts`, `scriptureTheme.css`, `settings/scriptureTheme.ts`) | KEEP (content-layer theming, as in 06 section 10.3) |
| 36 | Per-tab scroll memory (`readerScrollMemory.ts`, `useKeyedScrollMemory`) | KEEP (scroll anchors in `@SceneStorage`/state) |
| 37 | Pinned tabs (`isPinned`) | DROP-CANDIDATE (no setter anywhere, 03 U03) |
| 32 | Tags graph tab with pinch/pan | KEEP (`Canvas`) |
| 33 | PDF library page (partly flag-gated) | KEEP behind the same flag |
| 34 | Deep links, Spotlight, share inbox, intents, widget | KEEP (section 12) |

The ledger rows come from file inventory and the navigation docs; behaviours inside the 38 files under `src/mobile` that import desktop components (`BiblePanel`, `LexiconPanel`, `YouTubeTab`, notes editor) were not exhaustively read. The desktop component code that mobile reuses (e.g. `ChapterView`, `VerseRow` behaviours such as hover cards) must also be checked for touch-relevant behaviour before cut-over. This ledger should be re-derived mechanically (route list + test names) before any plan is considered complete.

---

## 15. Offline, lifecycle, performance, memory

### 15.1 Offline

VERIFIED: all texts, lexica, cross-references and TSKe are bundled (`App.app/data`); notes, highlights, sessions are local SQLite; iCloud sync is eventual (iCloud Drive files, no push; `NSMetadataQuery` + polling, 02 section 17.5); YouTube search/index (7 MB `youtube_index.db`) is offline but playback and transcript pack downloads need network; Kokoro voice pack is an opt-in download; Ask Berean on iPhone is **model-free** (`modelFreeLookup`, no LLM; 03 G10) with optional online research through `CapacitorHttp`. A native app keeps the same offline profile; `URLSession` with `waitsForConnectivity` for downloads (INFERRED).

### 15.2 Lifecycle

Current: `AppDelegate` (44 lines) stubs + `SceneDelegate` (30 lines) forwarding URL and user-activity events to Capacitor; JS flushes on `pagehide`/`visibilitychange`; sync host starts after first paint plus 1.5 s (`initIosSyncHost` deferred) and resumes on `visibilitychange` (`syncHost.ts:168`); share inbox drained on foreground; deep links queued until the shell registers its target. Native: `scenePhase` handling in the root scene, an `AppLifecycle` actor that pauses/resumes sync, flushes pending saves (note autosave, tab persistence 400 ms debounce, queue autosave 800 ms) on `.inactive`/`.background` and begins a `UIApplication.beginBackgroundTask` for the final journal write. The "flush pending writes" contract must be explicit because the debounced writers (3 different debounces) are the data-loss surface (INFERRED).

### 15.3 Performance and memory

- Measured (by the app's own perf doc, 03 S14, **UNVERIFIED** here and simulator-only): iPhone reader scroll p95 17 ms at 60 Hz, one frame over 25 ms of 120. No device measurements; no memory measurements ("Physical-device scroll and memory not measured").
- Native costs expected to *drop*: no WKWebView process, no JS bridge serialisation per DB call (every query currently crosses `BereanSQLite.query` as JSON, `CapacitorSqliteAdapter`, 159 lines), no React re-render storms from a 3,808-line store.
- Native costs expected to *appear*: TextKit 2 layout on long chapters (Psalm 119: 176 verses; Isaiah, Psalms of 150 chapters), highlight rendering attributes, Strong's attributed runs per word, `NSTextAttachment`-free design to limit memory (06 section 9.3).
- Targets to define before building: cold launch to first chapter, chapter swipe latency, FTS-as-you-type latency with all texts, resident memory with a Kokoro session loaded, and jetsam margin when a YouTube embed is open (BLOCKED: need a device).
- Database: WAL for `berean.db` is already set. Bundled text DBs ship in DELETE journal mode (the Mac `afterPack` converts them; iPhone copies the files as-is; 02 section 9, 03 X5); native opens them read-only (`SQLITE_OPEN_READONLY`, `immutable=1` URI is an option, INFERRED) and may memory-map large ones (cross_references 19.8 MB, tske_refs 45 MB, strongs_greek 28 MB). Lexicon "occurrences" are `LIKE` scans over `text_tagged` (no index, 03 S05); the same scan on a native stack will be cheaper but is still O(verses). A derived index table is a migration-time option, **not** part of parity.

---

## 16. Reusable SwiftUI components vs platform-specific interfaces

Shared across iOS and macOS (in `BereanUI` and `BereanDesign`, see 08 section 4): `Theme` + tokens, `SearchResultsList` (grouped Go to/Verses/Lexicon/Notes), `LexiconEntryView`, `StrongsEntryView`, `CrossReferenceList` (TSKe/Classic/My Notes), `NoteMetadataViews`, `TagChip`/`TagPicker`, `CalendarMonthView`, `TrailGraphCanvas` and `TagGraphCanvas` (both platforms host them; input differs), `ProgressViews`, settings `Form` sections that are identical, `AudioPlayerControls`, `CommandScope` model (not the surface), `VerseActionModel` (the action list; each platform renders it).

Platform-specific (not reusable): the Scripture text view subclass (`UITextView` vs `NSTextView`; shared logic below it), the chapter pager (iOS), the pane tree and pop-out windows (macOS), the tab cards sheet and floating controls (iOS), the sidebar and toolbars (macOS), the verse sheet detents (iOS) vs inspector panel (macOS), edit-menu vs context-menu construction, hardware keyboard command tables, widget/Share Extension/App Intents host targets, and platform-specific audio session code.

Principle (also 08): share models, view models, formatters, and pure text logic; do not share layout.

---

## 17. Platform-specific interfaces (protocol seams)

To keep modules free of UIKit/AppKit (08 section 4), the iOS target provides implementations of these protocols defined in shared packages:

`CloudContainerProviding` (ubiquity container URL, coordinated read/write, metadata query stream), `Haptics`, `SystemAppearanceProviding` (increase contrast, reduce motion/transparency, accent), `ResourceModeProviding` (Low Power Mode, thermal), `NowPlayingControlling`, `SpotlightIndexing`, `ShareInboxReading`, `LocationProviding` (When-In-Use only, sunrise-based daily-note boundary), `FilePicking`/`DocumentImporting`, `SecretStoring` (Keychain; today there are no secrets on iPhone and BYO cloud keys are Mac-only, 03 A02), `WebPlayerHosting` (YouTube), `PrintExporting`.

---

## 18. Risks and open questions

| # | Item | Status |
|---|---|---|
| I1 | Minimum iOS version: today 17.0. Rich `TextEditor` selection, glass APIs and tab-bar accessories may require 26 (availability UNVERIFIED). Install-base data not available to the audit | BLOCKED/UNVERIFIED |
| I2 | Landscape: declared but untested here; native reader and sheets need landscape rules | UNVERIFIED |
| I3 | Edge-back plus pager plus native sheets gesture arbitration | UNVERIFIED (device) |
| I4 | Notes editor fidelity (section 9) | UNVERIFIED, highest risk |
| I5 | Kokoro G2P without JS; ONNX memory on device | BLOCKED |
| I6 | Whether tab-cards actions stay custom or move to a context menu | DECIDE |
| I7 | Whether the Quick Open branch (`feature/quick-open-tabs`) is merged at this commit; the contract doc documents `reuse`, the code state was not verified | UNVERIFIED |
| I8 | iPad: not a target today; the native architecture should not preclude `NavigationSplitView` later, but nothing here designs for it | out of scope |
| I9 | Accessibility: no VoiceOver audit exists; native custom surfaces (text view, graph, tab cards drag) each need explicit accessibility work | BLOCKED (device) |
| I10 | Migration of localStorage-held preferences into native storage | open (coexistence plan) |

---

## 19. References

Apple documentation (Xcode documentation index, 2026-11-05; paths under `https://developer.apple.com`): `/documentation/SwiftUI/View/presentationDetents(_:)`, `.../presentationDetents(_:selection:)`, `.../presentationBackgroundInteraction(_:)`, `PresentationBackgroundInteraction.enabled(upThrough:)`, `.../presentationContentInteraction(_:)`, `CustomPresentationDetent`; `/documentation/SwiftUI/TextEditor`, `AttributedTextSelection`, `textInputFormattingControlVisibility`; `/documentation/UIKit/UIFindInteraction`, `UITextSearching`, `UITextSearchingFindSession`, `UITextView/isFindInteractionEnabled`, `UITextInteraction/gesturesForFailureRequirements`; `/documentation/UIKit/UITextView` TextKit accessors (`textLayoutManager`).

Repository: `docs/mobile/mobile-navigation.md`, `docs/navigation-contract.md`, `docs/ux-principles.md`, `src/mobile/**`, `src/lib/navigation/*`, `src/platform/ios/*`, `ios/App/App/{AppDelegate,SceneDelegate,BereanBridgeViewController,BereanIntents}.swift`, `ios/App/ShareExtension/ShareViewController.swift`, `ios/App/BereanWidget/BereanChatWidget.swift`, `ios/App/BereanNative/Sources/BereanNative/*.swift`, `docs/native-migration-audit/{02,03,14}-*.md`.

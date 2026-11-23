# Full feature parity — original Berean (Electron Mac + Capacitor iPhone) vs native (SwiftUI/AppKit/UIKit)

Authoritative feature-by-feature record (owner request 2026-11-12). Keyed by the audit's feature IDs (`docs/native-migration-audit/03-FEATURE-INVENTORY.md`).
Original behaviour, files and platform differences are quoted from the audit. Native status was verified in this repository and, where noted, in the running apps.
Issues live in `UX-AND-FUNCTIONAL-ISSUES.md`; screens in `SCREEN-INVENTORY.md`.

Status: ✅ parity or better (verified) · 🟡 partial · ❌ missing · ❓ unverified · — not applicable / deferred in the original.
Priority: P0 data-safety, P1 major missing workflow, P2 incomplete / usability, P3 polish or niche.

## Coverage summary

These historical inventory counts predate the later dated implementation entries. Use each row and the latest evidence before treating a feature as missing or complete.

- **Mac:** — 13, ✅ 37, ❌ 18, 🟡 36
- **iPhone:** — 15, ✅ 18, ❌ 17, 🟡 54

Largest open gaps (priority order): Study Trail (U14), sync (A01/H06), workspace/tab buildup, sunrise-aware daily notes (N12), iPhone cross-verse touch QA (S07/H02), remaining Notes home parity (N11), advanced note structures (N04/N05), PDFs/YouTube/Read Aloud/Ask Berean (U17, M01, M05, G01).

## 2026-11-23 — Claude audit follow-up

| Feature | Verified update | Open acceptance |
|---|---|---|
| S02 / S09 — Passage picker | Mac and iPhone Simulator opened KJVA Books with the current book highlighted and exercised New Testament and Apocrypha navigation, including the Sirach prologue. | Wider translation and physical-device matrix. |
| Q04 — Lexicon | Six package tests passed for match-centered excerpts. | Check late matches in narrow and full panes and full-verse copy in the running apps. |
| N03 / N04 / N05 / N11 — Notes | Built validated single-undo slash edits, iPhone hardware slash-menu routing, visible-card Board bulk selection, and wrapping that keeps wide cells visible. | Keyboard, undo, Board and table runtime checks. Full horizontal editing of wide tables remains open. |
| U14 / U18 — Study Trail and Messages | Mac sidebar and iPhone More opened both destinations without creating tabs. Package tests passed with Study Trail service guards and recursive move and split coverage. | Trail mutation and failure UI, Messages scope and error recovery, and accessibility actions. |
| U17 — PDFs | Built a bookmark-label sheet that preserves input on an error. | Verify failure, draft retention, and retry in the running apps. |
| A04 — Spotlight | Built Spotlight session-title refresh for content changes. | Verify system Spotlight updates in the running iPhone app. |

Both native builds and the full 370-test package run passed. Existing parity gaps remain open. [Audit evidence](CLAUDE-AUDIT-2026-11-23.md)

## Index

| ID | Feature | Original status | Mac | iPhone | Pri | Native state / next |
|---|---|---|---|---|---|---|
| S01 | Text loading and bundled texts | implemented | ✅ | ✅ | — | All 19 texts bundled; lxx→lxx_brenton mapping fixed; text list = legacy TRANSLATIONS (KJV hidden, Hermas Taylor listed) |
| S02 | Book / chapter / passage navigation | implemented | ✅ | ✅ | P1 | iPhone chapter swipe, edge taps and pull navigation verified with real simulator gestures 2026-11-20: right/left edge tap Psalm 50↔51 (LXX); pull up past the end → next chapter, pull down past the top → previous; a flick that only reaches the end by momentum does NOT change chapter (pull must start at the edge). Go reuses reading tabs. iPhone Simulator verified prepared LXX rows for Exodus 32 (skips 9, opens 35), 1 Kings 14 (21–31, opens 31), Psalm 115 (4–5 opens raw 4), and Psalm 3 (display 1 opens raw 2). Physical-device and software-keyboard matrices remain open. [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md) |
| S03 | Reference parsing | implemented | ✅ | ✅ | — | Golden-pinned parser + native resolver (bare book names, "Jude 5", other texts) |
| S04 | Verse rendering | implemented | ✅ | ✅ | P1 | Continuous TextKit readers on both platforms. Psalm superscriptions checked in the running iPhone app 2026-11-20: KJVA Psalm 3 title in muted italics under verse 1; Brenton Psalm 50 two title verses folded into one line, body shown as verse 1 with the KJV Psalm 51 note — the owner's grouped-title decision (CHANGELOG "Brenton Psalm titles belong to first displayed body verse1"), intentionally unlike the original's unnumbered line above. |
| S05 | Strong's rendering and lexicon access | implemented | ✅ | 🟡 | P1 | Mac and iPhone have tappable Strong’s links in continuous Scripture. iPhone Obadiah 1 H2377 opened the lexicon in Simulator. Mac hover now loads the lemma, transliteration, and gloss. Runtime hover verification remains pending. |
| S06 | Interlinear | deferred | — | — | — | Deferred in original too |
| S07 | Selection and copying | implemented | ✅ | 🟡 | P1 | Both readers use a single selectable chapter. Whole-verse reader clipboard verified for single, range and gapped selections on Mac and iPhone Simulator. Cross-verse text handles, partial-reference gestures and individual copy entry points still need runtime coverage. |
| S08 | Verse context menus and actions | implemented | ✅ | 🟡 | P2 | Verse actions: copy, highlight, tag verse/chapter, add note, verse notes, cross refs, open in new tab. Copy Reference and Compare This Verse also available. Play Audio from Here remains open. |
| S09 | Multiple translations and editions | implemented | ✅ | ✅ | — | Text switching in the navigator, a direct KJV/LXX control, and Compare mode for parallel texts |
| S10 | Reading position and history | implemented | ✅ | 🟡 | P3 | Per-tab back/forward, recent passages in the picker, and a History view. Both readers preserve the visible verse on same-chapter reflow. Search and Notes folders keep row anchors per tab and view configuration for the current run. Mac Search and Notes folder history round trips passed live. Same-chapter Scripture round trips restored exact saved offsets on Mac and iPhone Simulator. Mac cross-chapter and Scripture–Lexicon Back/Forward also returned exact saved offsets. Compare Back/Forward preserves each visit’s selection in the current session, verified on Mac and iPhone Simulator. Missing-viewport, broader type combinations, relaunch persistence and full tab coverage remain open. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md) [History evidence](HISTORY-VIEWPORT-RESTORATION-2026-11-21.md) |
| S11 | Reading preferences | implemented | 🟡 | 🟡 | P2 | Font size and family, line spacing, text width, verse-number visibility, red lettering, word replacer and theme. The reader exposes display options on both platforms. Mac View commands adjust Scripture text size with the original zoom shortcuts. iPhone Scripture supports pinch-to-resize, pending gesture QA. Per-text hidden annotations are implemented (Display Options → per-edition toggles, original `hiddenAnnotations` tab state). App-wide zoom (Electron webContents zoom) maps natively to Dynamic Type on iPhone (reader scales via scriptureTypeScale) and the View text-size commands on Mac — no separate whole-window zoom by design. Paragraph mode was never in the original. Pinch-to-resize verified with two-finger synthesized pinches on the iPhone sim 2026-11-22 (spread 60→220 pt: 16→30 max; pinch 240→80 pt: 30→12 min, proportional and clamped). |
| S12 | Cross-references | implemented | ✅ | 🟡 | P2 | Cross refs (TSKe/Classic) in study panel; iPhone via inspector sheet (not device-verified) |
| S13 | Parallel comparison | implemented | 🟡 | 🟡 | P2 | Same-passage columns align by verse. Change Column Passage opens the chapter picker for one column. Different passages scroll independently in wide windows and use sections at narrow widths. Focused-column Mac Presenter now follows a selected secondary edition; actual LXX selection and pause/tab-switch/resume pass. Mac also verified pinned Psalm 3 LXX secondary presentation, Clear returning to the primary, and synced KJV Jonah 1:17 projecting LXX Jonah 2:1. Mac and iPhone Simulator verified secondary selection through a column swap and Back/Forward. Each visit retains its own selection during the current session. The audited narrow viewport-transfer mismatch, persisted viewport, broader mapped/reorder/scroll, rapid navigation, accessibility and physical input matrices, and full mirroring remain open. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md) [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md) |
| S14 | Very long chapter performance | verified (device) | ✅ | ✅ | P2 | Both TextKit readers render the whole chapter. KJV Psalm 119: iPhone sim ≈ 17–25 ms, Mac ≈ 19–23 ms build+layout (S14-PSALM-119-TIMING-2026-11-20.md); physical iPhone 16e 2026-11-22: render 11 ms, on screen by the next run loop at 31 ms. |
| S15 | Find in chapter | implemented | ✅ | ✅ | P2 | Mac glass find bar; iPhone More → Find in Chapter opens the system find navigator (verified earlier in HANDOFF) |
| S16 | Word replacer (display rules for divine names and search expansion) | implemented | ✅ | ✅ | — | Word replacer display + search variants + Strong's bridge |
| Q01 | Scripture full-text search | implemented | ✅ | 🟡 | — | Both app bundles carry all 19 supported Scripture IDs. All Texts searches the bundled corpus; Mac opened Didache via ⌘K. |
| Q02 | Reference search | implemented | ✅ | ✅ | — | References in ⌘K/New/search field go to passage |
| Q03 | Strong's search | implemented | ✅ | 🟡 | — | Strong's number queries (single/multi + words), uncapped occurrences for search (native improvement over legacy 1000 cap), and matched-word snippet highlighting with Word Replacer remapping |
| Q04 | Lexicon search | implemented | 🟡 | 🟡 | P2 | Dedicated Lexicon tab and palette search with All/Hebrew/Greek filters. Simulator verified deep entry return and relaunch restoration, plus rapid Return/Clear recovery. Mac rows verified 2026-11-22 (⌘K → Search Lexicon for “shepherd”: H7462 first, rows with number, lemma, transliteration, gloss, count; Greek filter → G4166/G750/G4165). In-tab history verified on Mac (entry → ⌘[ returns to the same search with query/filter). Bug fixed: Mac BDB Notes squeezed into a narrow column overlapping Derived Terms (BdbSelectableText returned nil for an unspecified width). Accessibility audit on iPhone sim (H7462): toolbar buttons named, derived terms are single buttons ("H4828, מֵרֵעַ, companion, friend."), BDB notes readable as a text area; entry section titles now carry the header trait for the VoiceOver heading rotor (trait not shown in the XCUI dump). A real VoiceOver pass remains with the owner's device pass. |
| Q05 | Notes search | implemented | 🟡 | 🟡 | P1 | Notes home supports folder/global scope, type/status, three FTS match modes, excerpts and live refresh. Mac ⌘K includes notes. |
| Q06 | Indexing | implemented (FTS), partial (others) | ✅ | ✅ | — | FTS5 per text; deterministic ordering (ADR-0008) |
| Q07 | Filtering and ranking | implemented / partial ranking | ✅ | 🟡 | — | Testament, books, match mode, scripture/relevance order, grouping by text/book/none |
| Q08 | Semantic search and embeddings | partial (Mac dev only; not shipped) | — | — | — | Dev-only in original |
| Q09 | Floating search / unified Search Berean / command palette | implemented | ✅ | 🟡 | P2 | Mac floating search and iPhone Go group passage, Strong’s, Notes, and Scripture destinations with previews. Unified verse-result streams and YouTube remain open. |
| Q10 | YouTube transcript search | implemented (see M04) | 🟡 | 🟡 | P3 | Videos section in Go / ⌘K opens the video at the matched moment (2026-11-20); needs transcript data in native libraries |
| N01 | General, verse and daily notes | implemented | 🟡 | 🟡 | P1 | General and verse notes create/edit; Today’s Note and the Calendar open daily notes on both platforms. |
| N02 | Markdown model and ProseMirror structure | implemented | 🟡 | 🟡 | P1 | Live-preview editor over verbatim Markdown (ADR-0014) — no data loss by construction; structures shown simplified |
| N03 | Inline formatting and block types | implemented | 🟡 | 🟡 | P2 | Bold/italic/underline/strike/highlight/code/headings/quotes/callouts/lists/tasks render; commands ⌘B/I/U etc. Format menu supports inline styles, headings, lists, and six named highlight colors. Existing legacy highlight colors render in the native editor. List continuation and checkbox toggling are implemented. Slash menu (original SLASH_COMMANDS with native equivalents: text, H1–H3, lists, task, quote, code, table, image, divider, five callouts; typed filter, arrow/Return/Esc on Mac) verified on iPhone sim and Mac (real key events: / ↓ ↓ Return → '## ') 2026-11-22. Not ported: Columns / Thread / Study Trail blocks (web-editor node types). Live checklist QA 2026-11-22 (sim): /task creates a checklist, Return continues items, tapping a box writes [x]. Bug fixed: after edits the box could draw as "☐ ]" — TextKit regenerated glyphs starting inside a substituted run and the editors didn't carry the substitution across chunks (fixed in both editors; Mac checked with indented tasks, a ticked box and a Tip callout while typing). |
| N04 | Tables | implemented | 🟡 | 🟡 | P2 | Markdown tables support insertion, row and column add/delete, whole-table deletion, keyboard cell navigation, and iPhone cell controls in the edit menu and above the software keyboard. Mac whole-table deletion, undo, redo, and note reopening passed live QA. Complete tables render with a header fill and cell borders in the Notes body font. Insertion and undo/redo passed on the iPhone simulator. Previously malformed iPhone separators are recognized without changing stored Markdown. Wide tables FIXED 2026-11-22: tables wider than the editor used to wrap mid-row and break the grid (header fill landed on the paragraph above, rows vanished — iPhone, 8 columns). Now the table's text shrinks to fit (≥ 65 %), and if still too wide rows stay on one line with the grid drawn normally and the right edge clipped; tables restyle on width changes. Verified on sim (8 short columns fit; 8 long columns aligned + clipped; 3-column table unchanged) and Mac (12 columns shrunk + clipped with an intact grid). Horizontal scrolling of clipped columns is not available; broader editing QA remains. |
| N05 | Images and attachments | partial | 🟡 | 🟡 | P2 | data: and remote https images render in both editors with captions and saved width; insert from Photos/Files/paste; resize (Mac drag handle, iPhone Image Size presets); Presenter/previews show them (NOTE-IMAGES-2026-11-20.md). Open: vault `attachments/` files (needs vault sync) |
| N06 | Links, wikilinks and Scripture references | implemented | 🟡 | 🟡 | P2 | Links, wikilinks, bare Scripture references and explicit Strong’s numbers are linked in the native editors. Note-title completion includes a passage/excerpt preview. Plain Scripture and Strong’s block suggestions passed Simulator insertion and Undo checks. Cross-chapter blocks and Mac runtime verification remain open. |
| N07 | Autosave | implemented | ✅ | ✅ | — | 600 ms autosave + snapshots on idle/leave/close |
| N08 | Undo/redo and version history | implemented | ✅ | 🟡 | — | Version history sheet with a compact iPhone selector and full-width preview; restore with pre-restore snapshot (golden); undo via text system |
| N09 | Export, import, print | implemented | ✅ | 🟡 | — | Markdown export, import and copy; system note printing with formatted Markdown. System print preview verified on Mac and iPhone Simulator; Files and multipage output checks remain. |
| N10 | Vault integration (Octarine/Obsidian) | implemented (Mac only) | ❌ | — | P2 | Vault sync not ported (M7-03) |
| N11 | Folders, trash, pin, status, icons, board, list views | implemented | 🟡 | 🟡 | P2 | Notes supports folder navigation, List/Gallery, sort/group, bulk selection/share, pin/trash/restore and scoped search. Gallery opening and return passed on Mac and iPhone simulator. Layout and All Notes location survived relaunch on both platforms. Collapsible sections and hidden-selection counts are implemented and runtime checked on Mac and simulator. Board layout (original NotesBoardView: status lanes, drag a card to change status) verified on iPhone sim 2026-11-22; broader accessibility QA remains. |
| N12 | Daily notes, calendar and sunrise day boundary | implemented | 🟡 | 🟡 | P2 | Both apps have month and week grids, direct month/year navigation, and a scrollable daily-note timeline with previews and calendar return. Date-to-note navigation uses the legacy keys. Today supports sunrise using an optional locally stored location, with a midnight fallback. |
| N13 | Idiom / reference-book editor | implemented, niche | 🟡 | 🟡 | P3 | Idiom notes with header editor; Mac reader underline + click + meaning tooltip, reference-book export (2026-11-20, IDIOMS-2026-11-20.md) |
| N14 | BibleGateway notes importer | implemented (Mac only; contradicts CLAUDE.md) | ❌ | — | P3 | BibleGateway importer (Mac) not ported |
| N15 | e-Sword import | implemented (Mac only) | ✅ | — | P3 | File → Import from e-Sword… with review (2026-11-20, ESWORD-IMPORT-2026-11-20.md) |
| H01 | Storage | implemented | ✅ | ✅ | — | Highlights service golden-verified |
| H02 | Verse, word and selection highlights; offsets and anchoring | implemented | ✅ | 🟡 | P2 | Both readers map text selections into existing stored character offsets. Mac partial selection previously verified; iPhone verified 2026-11-22 with real touches on the sim: long-press “beginning” in John 1:1 → Highlight Selection → Green stored as start_char 7 / end_char 16 (original offsets), and after relaunch only that word is tinted. |
| H03 | Colours and categories | partial | ✅ | ✅ | — | 5 colours |
| H04 | Note and tag indicators on verses | implemented | ✅ | 🟡 | — | Note dots + tag chips (Mac); iPhone note dots, tag chips in rows |
| H05 | Cross-translation highlights | absent (documented in CLAUDE.md §15 as a setting) — deferred | — | — | — | Deferred in original |
| H06 | Highlight sync | implemented | ❌ | ❌ | P1 | No native sync (M4) |
| U01 | Spaces | implemented | ✅ | ✅ | — | Spaces as tab types, ⌘1–5 |
| U02 | Vertical tabs, sessions, archive | implemented | ✅ | ✅ | — | Unified Workspaces (ADR-0011), archive, ordered tab list |
| U03 | Pinned tabs | partial (data only; no setter) | ✅ | ✅ | — | Pin/unpin + drag into Pinned (native adds setter) |
| U04 | Tab and session persistence | implemented | ✅ | ✅ | — | Synced sessions/tabs tables, relaunch restore |
| U05 | Workspaces and layouts | implemented | ✅ | 🟡 | — | 16 layouts (Mac); saved workspaces both |
| U06 | Resizable panels, drag and drop | implemented (Mac) | 🟡 | — | P2 | Split panes; no drag tabs into panes |
| U07 | Multi-window, floating panels, presenter/viewer | implemented (Mac only) | 🟡 | — | P2 | New Window + Presenter (⌘⇧B), rendered pause snapshots, rich notes, reader filters and scoped Close behavior; actual bounded UI checks in PRESENTER-MESSAGES-POLISH-2026-11-20.md. Laser/compare/side panel/floating tabs and full focus/zoom matrix open |
| U08 | Navigation state and history stacks | implemented | ✅ | 🟡 | — | Per-tab history; [sidebar ‹ ›] group (Mac); iPhone Back/Forward in More |
| U09 | Menus, context actions, commands | implemented | 🟡 | 🟡 | P2 | Menus/context menus partial; ⌘K/Go has a Commands group (notes, calendar, history, tags, PDFs, YouTube, lexicon, workspace, tab and reader commands; iPhone also Berean Chat) |
| U10 | Keyboard shortcuts | partial | 🟡 | — | P2 | Core shortcuts; searchable list in Settings → Keyboard Shortcuts (refreshed 2026-11-20 with presenter/chat/headings/text size); editing deferred as in the original |
| U11 | Themes and appearance | implemented | ✅ | ✅ | — | System/light/dark; dark mode visually checked on Mac reader/search |
| U12 | Settings | implemented | 🟡 | 🟡 | P2 | Reading, Appearance, Workspaces, Library. Includes preferred Shepherd of Hermas edition; History pane (tabNavMaxStack, historyMaxEntries, clear) and Ask Berean Search In (2026-11-20). Print & Export pane (2026-11-20); Reading themes from the original presets on the Scripture page (READING-THEMES-2026-11-20.md); custom themes (create/edit/duplicate/delete, original `customThemes`); Danger (delete notes) open; the spec's text ordering never existed in the original. |
| U13 | Onboarding and hints | partial | 🟡 | 🟡 | P3 | Getting started flow + replay; TipKit hints (Search, PiP, Ask follow-up, Strong's, note format, verse actions, highlight, compare) with Reset Hints (2026-11-20, ONBOARDING-2026-11-20.md); reader/editor hints open |
| U14 | Study Trail | implemented | 🟡 | 🟡 | P1 | List, branch map, search, ordering, recording, tag assignment, and sticky notes use legacy rows. Merge Into / Split Here, Move to Trail (moveNodes, chained connections follow) and Mark as New Topic (is_topic_break divider) verified 2026-11-22. Map folding (shared trail_collapse) and multi-stop Select → Move verified 2026-11-22; marquee drag-select replaced by native selection mode. |
| U15 | Tasks panel and first steps | implemented (Mac only) | 🟡 | 🟡 | P3 | Getting Started checklist with original completedStepIds + native detection, on both platforms (2026-11-20) |
| U16 | Tags and tag graph | implemented | 🟡 | 🟡 | P3 | Verse tags (golden), chips, picker, #tag search, Tag Manager (rename/colour/merge/delete) and Tag Graph (2026-11-20: force layout, drawn connections with arrows/dashed/colour/note, shared-verse lines, pin by drag, inspector). Physical touch/trackpad pinch and large-graph performance unverified. |
| U17 | PDFs | partial | 🟡 | 🟡 | P2 | Library + PDFKit reader with highlights, notes, bookmarks, outline, find, page restore and missing-file re-attach (2026-11-20). Bookmark labels (original prompt, "Page N" default) + Rename verified 2026-11-22. Share Extension intake and experimental gate open. |
| U18 | Berean Chat (notes-style chat) | implemented | 🟡 | 🟡 | P3 | Conversations/Unfiled/pins/folders/replies/edit/delete; rich bubbles, glass composer, local drafts, search/destinations and scoped message identities. Bounded Mac+iPhone checks in PRESENTER-MESSAGES-POLISH-2026-11-20.md; automatic/explicit reference routing and long/table content checked; accessibility pass 2026-11-22 (sim AX tree): verse chips are single labelled buttons; each message's author/time is now one element read before the text ("You, 6:52 AM" / "Berean, 12:26 PM, edited"); Reply/Copy/Delete are VoiceOver actions on the message. Failure injection 2026-11-22 (sim, external EXCLUSIVE lock on the DB): Send → "Message Couldn’t Be Saved — Your message is still in the composer. Berean’s library is busy right now. Try again in a moment." and the draft stays; after the lock releases the same Send saves. Database errors now have plain-language descriptions (SQLiteError: LocalizedError); deleting a message reports a failure instead of ignoring it. Model-free Ask saves into Chat. |
| M01 | YouTube browsing and playback | implemented | 🟡 | 🟡 | P2 | WebKit tab: channel list, browse/watch, sign-in persists, timestamp links (2026-11-20, YOUTUBE-TAB-2026-11-20.md); no scraped feed/transcripts |
| M02 | Picture-in-Picture | implemented | 🟡 | 🟡 | P3 | Manual PiP button + ⇧⌘P; pages persist across tab switches; auto-PiP on tab switch not achieved (YOUTUBE-TAB-2026-11-20.md) |
| M03 | Video-linked notes and timestamps | implemented | 🟡 | 🟡 | P3 | Insert timestamp link into an open note; YouTube links in notes open the YouTube tab at that moment (2026-11-20) |
| M04 | Transcripts and transcript search | implemented (dev-fetch model) | 🟡 | 🟡 | P3 | Read-only service + in-tab transcript with seek (2026-11-20, YOUTUBE-TAB-2026-11-20.md); no transcript data in native libraries yet; not in global search |
| M05 | Read Aloud engine (Kokoro) | implemented | ❌ | ❌ | P2 | Read Aloud not ported |
| M06 | Audio playback, seeking, queue and background | implemented | ❌ | ❌ | P2 |  |
| M07 | Word-follow highlighting | implemented (estimated, not forced alignment) | ❌ | ❌ | P3 |  |
| M08 | Voice downloads and caching | implemented | ❌ | ❌ | P3 |  |
| M09 | Sleep timer (iPhone) | undocumented | — | ❌ | P3 |  |
| G01 | Direct references and Strong's without a model | implemented (statuses: SPEC "Complete") | 🟡 | 🟡 | P2 | Model-free Ask Berean: word studies, Strong's, references, labelled keyword fallback, Strong's comparison, KJV/LXX parallel, exclusions, follow-ups (2026-11-20, ASK-BEREAN-MODEL-FREE-2026-11-20.md) |
| G02 | Local model runtime (Ollama), model picker, downloads | partial | ❌ | ❌ | P3 |  |
| G03 | Ask Berean modes (Commentary ON/OFF), prose stripping, premise check | implemented (ON partial) | ❌ | ❌ | P3 |  |
| G04 | Deep Search, escalation, cancel and time budgets | implemented (Mac), partial (budgets) | ❌ | — | P3 |  |
| G05 | Collections, study profiles, saved contexts, memory | implemented | ❌ | ❌ | P3 |  |
| G06 | Verse-note influence and note exclusion | partial | ❌ | ❌ | P3 |  |
| G07 | Cloud model (BYO key) | partial (Mac), not implemented (iPhone) | ❌ | ❌ | P3 |  |
| G08 | Online research (Wikipedia, Sefaria) | partial | ❌ | ❌ | P3 |  |
| G09 | Retrieval benchmark and evaluation harness | implemented (dev tooling) | — | — | — | Dev tooling |
| G10 | iPhone Ask Berean (model-free) | partial | — | 🟡 | P3 | Same model-free sheet on iPhone (2026-11-20) |
| A01 | iCloud sync (journal) | implemented, device matrix BLOCKED | ❌ | ❌ | P1 | Sync engine port pending (M4, OD-5 gates) |
| A02 | Keychain / secure storage | partial | ❌ | ❌ | P3 |  |
| A03 | App Groups and Share Extension | implemented (iPhone) | — | ❌ | P2 | Share Extension not built for native |
| A04 | Spotlight | implemented (iPhone) | — | 🟡 | P3 | Notes, workspaces, books and tab sessions indexed; tap opens via deep link (sessions verified 2026-11-22 via in-app CSSearchQuery self-test) |
| A05 | App Intents and Siri Shortcuts | implemented (iPhone) | — | 🟡 | P3 | Four intents + phrases (2026-11-20); their routes verified on sim 2026-11-22 (APP-INTENTS-2026-11-20.md); Siri/Shortcuts invocation needs a device; Read Aloud intent pending (Codex's Read Aloud) |
| A06 | Deep links and URL schemes | implemented | 🟡 | 🟡 | P2 | All routes except share handled (berean-native-dev for the Dev build; 2026-11-20, DEEP-LINKS-2026-11-20.md) |
| A07 | Widget | implemented (iPhone) | — | ❌ | P3 |  |
| A08 | File providers / document access | partial | 🟡 | 🟡 | — | Open/save panels, document picker |
| A09 | Notifications | absent (deferred) | — | — | — | Deferred |
| A10 | App lifecycle | implemented | ✅ | ✅ | — | Single-instance lock, autosave on quit |
| A11 | Entitlements, sandbox, identity | implemented | ✅ | ✅ | — | Native dev identities isolated; device deploy guards |
| A12 | App Store requirements | partial | ❌ | ❌ | — | Release gate (not in scope) |
| A13 | Share/print/export to Files (iPhone) | implemented | 🟡 | 🟡 | P2 | Note share/export; no verse share sheet |
| A14 | Accessibility | partial | 🟡 | 🟡 | P2 | Labels/hints on new controls; no full VoiceOver pass |
| A15 | Auto-update and distribution (Mac) | implemented | ❌ | — | — | Release gate |
| O01 | Deep-linked "Berean Dev" identity separation | implemented (A11 covers). | ✅ | ✅ | — |  |
| O02 | Crash report on next launch | implemented (`CrashReport.tsx`, `ErrorBoundary.tsx`; Mac and iPhone mounted in `src/main.tsx`). | 🟡 | 🟡 | P3 | MetricKit crash diagnostics → banner with Copy Details / Dismiss (2026-11-20, CRASH-REPORT-2026-11-20.md)  |
| O03 | Hermas / Recognitions special-case handling | implemented | 🟡 | 🟡 | P2 | Hermas sections/Recognitions numbering in parser; Hermas translation choice not exposed |
| O04 | Data publication pipeline | implemented | — | — | — | Pipeline unaffected |
| O05 | Diagnostics and performance tooling | implemented | — | — | — |  |

## Detail (original behaviour → native)

### S01 Text loading and bundled texts
- **Original (both):** Opens one read-only SQLite DB per text; `getBooks`, `queryChapter`, `queryVerse`, `queryVerses` (batch, capped 500), per-book chapter-count fallback for texts storing `chapters_count = 0` (LXX). Book names normalised (roman → arabic) in `getBooks`. 18 editions registered in `TRANSLATIONS` (`src/lib/bibleTexts.ts`): KJVA, Brenton LXX, 1 Enoch, Jubilees, Apoc. Elijah, Recognitions of Clement, Hermas (ANF and Taylor), Asc. Isaiah, Ep. Barnabas, T12P, Gad, T. Job, 1 Clement, Apoc. Abraham, Didache, T. Jacob, 2 Baruch. `kjv.db` is also bundled; `lxx.db` is an orphan shipped by glob on Mac only.
- **Mac vs iPhone (original):** Identical code path; iPhone opens from `App.app/data/` bundle. iPhone omits `lxx.db`, `youtube_seed.db` (split into `youtube_index.db` plus downloadable packs).
- **Original files:** `src/platform/services/bibleService.ts`; `electron/db/bible.ts` (TEXT_FILES map), `electron/ipc/bible.ts`; `src/platform/ios/services.ts`; `src/lib/bibleTexts.ts`; `src/lib/chapterCache.ts`; `scripts/seed_*.py`, `scripts/fix_*.py`, `scripts/convert-dbs.js`.
- **Known original defects:** Data defects documented: concatenated multi-verse rows in some pseudepigrapha (`scripts/DATA_BUG_long_verse_rows.md`; `enoch.db` fix script exists, others "audited"); `lxx.db` has no UNIQUE verse key (PLAN.md); KJV italics markup missing in `kjva.db` (memory note; `ANNOTATION_KEYS.kjva_italics` exis
- **Native Mac / iPhone:** ✅ / ✅ — All 19 texts bundled; lxx→lxx_brenton mapping fixed; text list = legacy TRANSLATIONS (KJV hidden, Hermas Taylor listed)
- **Native files:** Corpora.swift, AppModel.swift availableTexts
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S02 Book / chapter / passage navigation
- **Original (both):** Reference bar, book/chapter picker, prev/next, continuous chapter scroll, pull-past-end rubber-band navigation, go-to-verse digits, `berean:next/prevChapter` events; iPhone horizontal pager and Go-to sheet; LXX↔KJV chapter mapping for Psalms and Jeremiah (chapter-level only).
- **Mac vs iPhone (original):** Different UI per platform, one parser (S03). Pull-nav physics is Mac trackpad; iPhone uses swipe + edge-back.
- **Original files:** `src/components/bible/{BiblePanel(4382 lines),BookChapterPicker,ContinuousChapterScroll,useChapterPullNav,ChapterPullIndicator}.tsx`; `src/lib/{bibleNav,translationChapterMap,verseNavigation,scrollToVerse}.ts`; `src/mobile/reader/{ReaderPage,PassagePicker,ReferencePicker,CompactPassageHeader}.tsx`.
- **Known original defects:** Verse-level LXX mapping not implemented (file header, VERIFIED). BiblePanel 4382 lines is a concentration risk.
- **Native Mac / iPhone:** ✅ / 🟡 — iPhone chapter swipe, edge taps, pull navigation and Go reuse passed in Simulator. iPhone Simulator verified prepared LXX rows for Exodus 32 (skips 9, opens 35), 1 Kings 14 (21–31, opens 31), Psalm 115 (4–5 opens raw 4), and Psalm 3 (display 1 opens raw 2). Physical-device and software-keyboard matrices remain open. [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md)
- **Native files:** PassagePicker.swift, ScriptureView.swift step()
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S03 Reference parsing
- **Original (both):** Parses book tokens, abbreviations, ranges, comma lists, chapter-only, Hermas/Recognitions forms, multi-book queries, roman/arabic variants, Strong's refs, canonical `book.chapter.verse` ids, and emits display, filename, wikilink forms.
- **Mac vs iPhone (original):** Same on both.
- **Original files:** `src/lib/parseRef.ts` (1054 lines), `multiBookSearch.ts`, `strongsSearch.ts`, `hermasMap.ts`, `chapterNumbering.ts`, `prologueBooks.ts`, `verseRangeFormat.ts`, `tests/unit/parseRef.test.ts`.
- **Known original defects:** Duplicate `safeFtsQuery` exists in `parseRef.ts` and `bibleService.ts` with different behaviour (VERIFIED); a third copy `electron/ipc/numberWords.ts`/`src/lib/numberWords.ts` duplicates number-word tables.
- **Native Mac / iPhone:** ✅ / ✅ — Golden-pinned parser + native resolver (bare book names, "Jude 5", other texts)
- **Native files:** BereanReference, PassageResolver.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S04 Verse rendering
- **Original (both):** Verse rows with number badge, tagged tokens, KJV italics, red-letter, translator-supply brackets per text (`ANNOTATION_KEYS` with hide toggles), Psalm superscriptions, section titles (`title` column), paragraph-style books, indicator dots, per-verse hover cards for idioms, flash/scroll targets, LXX repeated verses.
- **Mac vs iPhone (original):** Same renderer on both; iPhone adds long-press sheets.
- **Original files:** `src/components/bible/{VerseRow(2155),ChapterView(1431),TaggedVerseList,verseRowStyles}.tsx`; `src/lib/{taggedTokens,annotationFilters,psalmSuperscription,psalmTitles,verseTagRanges,scriptureText}.ts`; iPhone `src/mobile/study/VerseStudy.tsx`, `src/mobile/reader/readerViews.tsx`.
- **Known original defects:** Rendering depends on DOM text-node ordering for selection→offset conversion; any native replacement must reproduce exactly the character positions that existing highlights were stored with (see H02).
- **Native Mac / iPhone:** ✅ / ✅ — Continuous TextKit readers; Psalm superscriptions checked in the running iPhone app (KJVA Ps 3, Brenton Ps 50) per the owner's grouped-title decision.
- **Native files:** ChapterTextView.swift, ScriptureView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S05 Strong's rendering and lexicon access
- **Original (both):** Inline Strong's chips (toggle per tab `showStrongs`), hover tooltip (Mac) / tap sheet (iPhone), click opens Lexicon tab/panel, context menu (open, new tab, float, copy), chapter-wide "echo" of a Strong's number, selected-verses Strong's summary, multi-Strong's tokens, word-phrase grouping.
- **Mac vs iPhone (original):** iPhone: sheet drag-up instead of hover. Floating-lexicon items hidden on iPhone.
- **Original files:** `src/components/bible/{StrongsInline,StrongsTooltip,SelectedVersesStrongs}.tsx`; `src/components/lexicon/{LexiconPanel,LexiconTab,StrongsContextMenu,parts}.tsx`; `src/mobile/study/StrongsSheet.tsx`; `src/platform/services/lexiconService.ts` (432 lines); `electron/ipc/lexicon.ts`.
- **Known original defects:** LIKE-scan over all verses per lookup (no index); PLAN.md calls the `occurrences` tables stale. Hebrew occurrences lack `text_id`.
- **Native Mac / iPhone:** ✅ / 🟡 — Mac and iPhone have tappable Strong’s links in continuous Scripture. iPhone Obadiah 1 H2377 opened the lexicon in Simulator. Mac hover now loads the lemma, transliteration, and gloss. Runtime hover verification remains pending.
- **Native files:** ChapterTextView.swift, StudyViews.swift LexiconEntryView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S06 Interlinear
- **Original (both):** Not present. No Hebrew (Leningrad/MT) or Greek (GNT) interlinear, no morphology data (PLAN.md: "No morphology; none in any DB"). Only Strong's-tagged English (KJVA) and Greek-Strong's-tagged Brenton LXX alignment.
- **Mac vs iPhone (original):** —
- **Original files:** grep `interlinear` in `src`/`electron` finds nothing; only `CLAUDE.md` lines 361–362 and 966–967 mention it.
- **Known original defects:** Absence VERIFIED by grep.
- **Native Mac / iPhone:** — / — — Deferred in original too
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S07 Selection and copying
- **Original (both):** Verse-number click selection (single, range, multiple via shift/toggle), drag-select along verse numbers, text-range selection producing highlight toolbar, copy verse/ref/selection with KJV/LXX-aware formatting, Strong's-aware copy text, selection bar.
- **Mac vs iPhone (original):** iPhone: long-press → `VerseActionSheet`; tap numbers toggles.
- **Original files:** `src/lib/{verseSelection,verseClipboard,scriptureText,verseRangeFormat}.ts`; `src/components/bible/{VerseSelectionBar,VerseCopyMenu,verseDragSelect,verseInteraction,VerseDragIndicator}.ts(x)`; `src/mobile/study/{SelectionBar,MultiVerseSheet}.tsx`.
- **Known original defects:** `HIGHLIGHT_OFFSET_DEBUG = true` leftover logging was found and fixed in the 2026-10-19 performance pass (doc claim; fix not re-verified).
- **Native Mac / iPhone:** ✅ / 🟡 — Both readers use a single selectable chapter. Whole-verse reader clipboard verified for single, range and gapped selections on Mac and iPhone Simulator. Cross-verse text handles, partial-reference gestures and individual copy entry points still need runtime coverage. [Verse-copy evidence](VERSE-COPY-PARITY-2026-11-21.md).
- **Native files:** VerseClipboard.swift, ChapterTextView.swift, IOSChapterTextView.swift, ScriptureView.swift, CompareView.swift, ScriptureSearchView.swift and StudyViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S08 Verse context menus and actions
- **Original (both):** Right-click (Mac) / long-press sheet (iPhone): add verse note, show notes, cross refs, compare, tag, highlight swatches, copy, play audio from here, open in new tab/floating, idiom menu, note indicator menus.
- **Mac vs iPhone (original):** Floating-window items hidden on iPhone via `capabilities.multiWindow`-style checks (`platformCapabilities.ts`).
- **Original files:** `src/components/bible/VerseRow.tsx`, `VerseSelectionBar.tsx`; `src/mobile/study/VerseActionSheet.tsx`, `verseSheetMode.ts`, `src/mobile/primitives/{ActionSheet,PopoverMenu,anchoredMenu}.ts(x)`; Mac native menus built in main for some surfaces (`app:noteImageMenu`, `buildAppMenu`).
- **Known original defects:** none beyond UX drift between two implementations of the same action list.
- **Native Mac / iPhone:** ✅ / 🟡 — Verse actions: copy, highlight, tag verse/chapter, add note, verse notes, cross refs, open in new tab. Copy Reference and Compare This Verse also available. Play Audio from Here remains open.
- **Native files:** ScriptureView.swift verseNSMenu/verseActions
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S09 Multiple translations and editions
- **Original (both):** Per-tab translation, translation switch preserving reading anchor, per-text annotation toggles, chapter-number remap for LXX, KJVA default, edition grouping, `lxx:`-style prefixes in search.
- **Mac vs iPhone (original):** Same.
- **Original files:** `src/lib/bibleTexts.ts`, `translationChapterMap.ts`, `passageDestinations.ts`, `src/components/bible/BiblePanel.tsx`, `src/mobile/reader/*`.
- **Known original defects:** LXX numbering is chapter-level only; Hermas has two translations with different versification and `hermasMap.ts` bridging.
- **Native Mac / iPhone:** ✅ / ✅ — Text switching in the navigator, a direct KJV/LXX control, and Compare mode for parallel texts
- **Native files:** PassagePicker.swift, CompareView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S10 Reading position and history
- **Original (both):** Per-tab scroll memory and reading-anchor (verse + offset) carried across translation/mode switches; chapter progress for progress bars; navigation history table with day/session grouping, History tab/modal; per-tab back/forward stacks.
- **Mac vs iPhone (original):** iPhone adds edge-swipe back.
- **Original files:** `src/hooks/{useReadingAnchor,useKeyedScrollMemory,useChapterProgress}.ts`; `src/mobile/reader/readerScrollMemory.ts`; `src/platform/services/historyService.ts`; `src/components/shell/HistoryModal.tsx`; `src/mobile/history/HistoryPage.tsx`; `src/lib/historyModel.ts`; `src/store/index.ts` (`tabNavStac
- **Known original defects:** Reading position is device-local.
- **Native Mac / iPhone:** 🟡 / 🟡 — Per-tab back/forward, recent passages in the picker, and a History view. Both readers preserve the visible verse on same-chapter reflow. Search and Notes folders keep row anchors per tab and view configuration for the current run. Mac Search and Notes folder history round trips passed live. Same-chapter Scripture round trips restored exact saved offsets on Mac and iPhone Simulator. Mac cross-chapter and Scripture–Lexicon Back/Forward also returned exact saved offsets. Compare Back/Forward preserves each visit’s selection in the current session, verified on Mac and iPhone Simulator. Missing-viewport, broader type combinations, relaunch persistence and full tab coverage remain open. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md) [History evidence](HISTORY-VIEWPORT-RESTORATION-2026-11-21.md)
- **Native files:** AppModel goBack/goForward, PassagePicker recents
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S11 Reading preferences
- **Original (both):** Bible font family/size, line-height presets, verse-number visibility, red-letter, per-text hidden annotations, app zoom, pinch-to-zoom (iPhone), reader width/margins, themes (S-UI theme item).
- **Mac vs iPhone (original):** iPhone uses Dynamic Type bridging via `BereanA11yPlugin.swift` (INFERRED from plugin name; content not read in detail).
- **Original files:** `src/store/index.ts` prefs; `src/hooks/useBibleLineHeight.ts`; `src/lib/{zoom,fontFamilies,textFit}.ts`; `src/mobile/reader/{usePinchFontSize,readerWidth,scriptureTheme.css}`; `src/mobile/settings/scriptureTheme.ts`.
- **Known original defects:** Preferences do not sync via iCloud (X6).
- **Native Mac / iPhone:** 🟡 / 🟡 — Font size and family, line spacing, text width, verse-number visibility, red lettering, word replacer and theme. The reader exposes display options on both platforms. Mac View commands adjust Scripture text size with the original zoom shortcuts. iPhone Scripture supports pinch-to-resize, pending gesture QA. Per-text hidden annotations implemented; app-wide zoom = Dynamic Type (iPhone) / View text-size commands (Mac) by design; paragraph mode never existed in the original. Pinch-to-resize verified with two-finger synthesized pinches on the iPhone sim 2026-11-22 (spread 60→220 pt: 16→30 max; pinch 240→80 pt: 30→12 min, proportional and clamped).
- **Native files:** SettingsView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S12 Cross-references
- **Original (both):** Classic cross references (votes), TSKe (grouped headings, reciprocal), Taylor-Hermas footnotes, chapter-level "My Notes", reciprocal index; right panel on Mac (slots A/B), sheet on iPhone; viewer-window cross refs.
- **Mac vs iPhone (original):** Slot B (two simultaneous panels) Mac only; iPhone single sheet; TSK/Classic have no chapter-level rows.
- **Original files:** `src/platform/services/crossrefsService.ts`; `electron/ipc/crossrefs.ts` (352 lines, keeps sync helpers for AI); `src/lib/{crossRefIndex,crossRefs/xrefModel,notesCrossRefs}.ts`; `src/components/bible/BibleRightPanel.tsx` (2222); `src/components/viewer/ViewerCrossRefs.tsx`; `src/mobile/study/{CrossRe
- **Known original defects:** Data bug workaround in code; TSKe headings may be keyword-searched by AI (`searchTskeHeadingsByKeywords`).
- **Native Mac / iPhone:** ✅ / 🟡 — Cross refs (TSKe/Classic) in study panel; iPhone via inspector sheet (not device-verified)
- **Native files:** StudyViews.swift CrossRefsView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S13 Parallel comparison
- **Original (both):** 2–4 translation columns with sync scroll, stacked (iPhone, interleaved verse cells), verse compare entry, presenter feed, per-column Strong's.
- **Mac vs iPhone (original):** Mac side-by-side; iPhone interleaved; CLAUDE.md "unlock a cell" independent navigation is not found (grep `unlock` only matched unrelated UI strings; UNVERIFIED but likely absent).
- **Original files:** `src/components/bible/CompareView.tsx` (802), `src/mobile/reader/{ComparePage,compareState,compareInteraction}.tsx`, `src/components/viewer/ViewerCompare.tsx`, `src/platform/services/researchService.ts` (comparison payloads for AI), `src/lib/research/compareWords.ts`.
- **Known original defects:** Persistence of compare state fixed per memory note ("compare persistence").
- **Native Mac / iPhone:** 🟡 / 🟡 — Same-passage columns align by verse. Change Column Passage opens the chapter picker for one column. Different passages scroll independently in wide windows and use sections at narrow widths. Focused-column Mac Presenter now follows a selected secondary edition; actual LXX selection and pause/tab-switch/resume pass. Mac also verified pinned Psalm 3 LXX secondary presentation, Clear returning to the primary, and synced KJV Jonah 1:17 projecting LXX Jonah 2:1. Mac and iPhone Simulator verified secondary selection through a column swap and Back/Forward. Each visit retains its own selection during the current session. The audited narrow viewport-transfer mismatch, persisted viewport, broader mapped/reorder/scroll, rapid navigation, accessibility and physical input matrices, and full mirroring remain open. [Compare history evidence](COMPARE-HISTORY-2026-11-21.md) [Picker and toolbar evidence](PICKER-CHROME-2026-11-21.md)
- **Native files:** CompareView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S14 Very long chapter performance
- **Original (both):** Chapters are NOT virtualised. `ContinuousChapterScroll` windows chapters (`LOAD_AHEAD = 1`, `WINDOW_CHAPTERS = 2`, eviction); each chapter renders all verses (Psalm 119, Isaiah). Advanced search results and chat transcripts ARE virtualised (`@tanstack/react-virtual`, `ScriptureSearchView`).
- **Mac vs iPhone (original):** Doc reports Mac scroll with 0 frames over 25 ms and iPhone reader scroll p95 17 ms (60 Hz), one frame over 25 ms of 120, simulator only. Numbers are the doc's (UNVERIFIED by this audit); iPhone numbers are simulator, not device.
- **Original files:** `src/components/bible/{ContinuousChapterScroll,ChapterView}.tsx`; `docs/performance-audit-2026-10-19.md`; `scripts/perf/{nav,scroll}.*`.
- **Known original defects:** Physical-device scroll and memory not measured (doc says so). Chromium sibling-selector restyle problem fixed in CSS (doc).
- **Native Mac / iPhone:** ✅ / ✅ — Both TextKit readers render the whole chapter. Psalm 119 measured: Mac ≈ 19–23 ms, iPhone 16e 31 ms to on-screen (2026-11-22).
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S15 Find in chapter
- **Original (both):** Phrase/all/any highlight inside the chapter; handoff from search to find; iPhone `FindOnPage`.
- **Mac vs iPhone (original):** same.
- **Original files:** `src/components/shell/FindBar.tsx`, `src/lib/{scriptureFind,findHandoff,scriptureHighlight}.ts`, `src/mobile/reader/FindOnPage.tsx`.
- **Known original defects:** none known.
- **Native Mac / iPhone:** ✅ / ✅ — Mac glass find bar; iPhone More → Find in Chapter opens the system find navigator (verified earlier in HANDOFF) (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### S16 Word replacer (display rules for divine names and search expansion)
- **Original (both):** User-defined replacement rules applied at render time with search-variant expansion (typing a replacement finds the original word); settings sections on both platforms.
- **Mac vs iPhone (original):** same.
- **Original files:** `src/lib/wordReplacer.ts`, `src/components/settings/sections/WordReplacerSection.tsx`, `src/mobile/settings/WordReplacerPage.tsx`; used by search/unified search.
- **Known original defects:** `expandQueryForWordReplacer` is documented in its own comment as broken for production use and kept only for tests (VERIFIED).
- **Native Mac / iPhone:** ✅ / ✅ — Word replacer display + search variants + Strong's bridge
- **Native files:** BereanText WordReplacer
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q01 Scripture full-text search
- **Original (both):** FTS5 per text with modes all/any/phrase, prefix wildcards, number↔word alternates, scoped by books and optional chapter; ordered by FTS `rank`; limits 2000 (unscoped) / 5000 (scoped), `any` mode merges per-term queries and caps at 3000.
- **Mac vs iPhone (original):** Same; iPhone uses `src/lib/scriptureSearch.ts`.
- **Original files:** `src/platform/services/bibleService.ts` (`searchText`, `safeFtsQuery`, `cleanWords`), `src/lib/{scriptureSearch,scriptureSearchFilters,numberWords}.ts`, `src/components/bible/ScriptureSearchView.tsx` (2090), `src/mobile/search/*`.
- **Known original defects:** FTS query failures are swallowed (`catch { return [] }`); ranking is plain FTS rank, no cross-text blending (SPEC_STATUS notes keyword matches from other texts can outrank canonical verses in AI use).
- **Native Mac / iPhone:** ✅ / 🟡 — Both app bundles carry all 19 supported Scripture IDs. All Texts searches the bundled corpus; Mac opened Didache via ⌘K.
- **Native files:** ScriptureSearchView.swift, ScriptureSearch.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q02 Reference search
- **Original (both):** A typed reference jumps to chapter/verse/range; ambiguous book tokens listed; Go-to groups in unified search; typed-digit go-to in reader.
- **Mac vs iPhone (original):** —
- **Original files:** `parseRef.ts`, `searchIntent.ts`, `FloatingSearch.tsx`, `src/mobile/search/SearchSurface.tsx`, `src/lib/navigation/destination.ts`.
- **Known original defects:** none known.
- **Native Mac / iPhone:** ✅ / ✅ — References in ⌘K/New/search field go to passage
- **Native files:** PassageResolver.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q03 Strong's search
- **Original (both):** `H####/G####` direct entry; multi-Strong's AND/OR; search verses containing a Strong's number with word highlight segments; "any Strong's" mode.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/strongsSearch.ts`, `scriptureSearch.ts` (`runStrongsSearch`), `lexiconService.getOccurrences`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Strong's number queries (single/multi + words), uncapped occurrences for search (native improvement over legacy 1000 cap), and matched-word snippet highlighting with Word Replacer remapping
- **Native files:** ScriptureSearch.strongs
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q04 Lexicon search
- **Original (both):** Search over `strongs_id/word/transliteration/short_def/full_def/bdb_def` with LIKE and ordered CASE ranking; diacritic-insensitive transliteration match done in JS (`findByNormalizedTransliteration` loads all transliterations).
- **Mac vs iPhone (original):** —
- **Original files:** `lexiconService.search`, `electron/ipc/lexicon.ts`, `src/components/lexicon/LexiconPanel.tsx`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Lexicon search service ported; no UI entry other than Strong's numbers
- **Native files:** LexiconService.search
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q05 Notes search
- **Original (both):** FTS5 over notes `title, content` (migration v19, triggers + backfill), modes all/any/phrase, "untitled" special case, tag and chapter queries, idiom lists.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/notesService.ts` (`search`, `getByChapter`, `getChapterCounts`), `src/lib/panelDataCache.ts`.
- **Known original defects:** The index covers the raw markdown including inline base64 image data URLs (INFERRED from storage format, N05), which inflates the index and snippets.
- **Native Mac / iPhone:** 🟡 / 🟡 — Notes home supports folder/global scope, type/status, three FTS match modes, excerpts and live refresh. Mac ⌘K includes notes.
- **Native files:** NotesViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q06 Indexing
- **Original (both):** FTS5 for verses (prebuilt in data DBs), notes (`notes_fts`), YouTube transcripts (`youtube_transcripts_fts`); no index for lexicon, Strong's occurrences or note-to-verse references beyond `verse_ref`/`idx_notes_verse`; Spotlight index (iPhone) for notes, sessions, workspaces, books/chapters; embedding index is a dev artifact (Q08).
- **Mac vs iPhone (original):** —
- **Original files:** `bereanMigrations.ts` v13/v19; `scripts/build-embedding-index.js`; `src/platform/ios/spotlight.ts`; `BereanSpotlightPlugin.swift`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — FTS5 per text; deterministic ordering (ADR-0008)
- **Native files:** BibleService
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q07 Filtering and ranking
- **Original (both):** Filters by text, testament/book groups (10 presets), tag AND/OR, sort; unified search grouped results; AI collections (canon, apocrypha, pseudepigrapha, fathers) filter; YouTube search ranking (`rankVideosBySearch`); RRF fusion for AI candidates (`electron/rrf.ts`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{scriptureSearchFilters,search/unifiedSearch,youtubeSearch,research/collections}.ts`, `electron/rrf.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Testament, books, match mode, scripture/relevance order, grouping by text/book/none
- **Native files:** ScriptureSearchView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q08 Semantic search and embeddings
- **Original (both):** Query-time cosine search over a prebuilt `verse_embeddings.db` using Ollama `nomic-embed-text`; best-effort extra candidate source for Ask Berean; brute-force scan, quantised vectors (`embeddingQuantize.ts`).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/{embeddings,embeddingQuantize,rrf}.ts`, `electron/db/embeddingsDb.ts`, `electron/ipc/semanticCandidates.ts`, `scripts/build-embedding-index.js`, `scripts/eval/semanticEval.ts`.
- **Known original defects:** Not shipped in any build; SPEC_STATUS decision 11 "kept current index after measurement" while PLAN notes 17.4% semantic baseline (doc claim, UNVERIFIED). Brute-force scan cost unmeasured.
- **Native Mac / iPhone:** — / — — Dev-only in original
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q09 Floating search / unified Search Berean / command palette
- **Original (both):** Cmd+K/T modal (Mac): references, Strong's, keywords, notes, YouTube channels/videos, `>` commands (30 command ids), recents; iPhone plus/caret sheets and Search tab with scopes all/scripture/notes/lexicon and filters; "current tab vs new tab" destination contract.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/shell/FloatingSearch.tsx` (1678), `src/lib/{commands,search/*,navigation/*,searchNav}.ts`, `src/mobile/search/*`, `src/mobile/navigation/{NewTabSheet,destinationQuery}.tsx`, `docs/navigation-contract.md`.
- **Known original defects:** FloatingSearch 1678 lines of UI logic.
- **Native Mac / iPhone:** 🟡 / 🟡 — Mac floating search and iPhone Go group passage, Strong’s, Notes, and Scripture destinations with previews. Unified verse-result streams and YouTube remain open.
- **Native files:** `apple/Shared/StudyInspector.swift` (CommandPalette), `apple/Shared/GoSheet.swift`, `apple/Shared/PassageResolver.swift`
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### Q10 YouTube transcript search
- **Original (both):** 
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Videos section in Go / ⌘K opens the video at the matched moment (2026-11-20); needs transcript data in native libraries (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N01 General, verse and daily notes
- **Original (both):** Note types `general`, `verse` (also `esword`, `biblegateway` imported), `daily`; verse notes anchored by `verse_ref` (`book.chapter.verse`) + `text_id`; per-note colour, tags (JSON array), icon, status, pin, AI-exclusion flag, folder id.
- **Mac vs iPhone (original):** iPhone cannot print via Electron; uses `BereanPrintPlugin`. Verse sheets embed an in-place editor.
- **Original files:** `src/platform/services/notesService.ts` (769 lines), `electron/ipc/notes.ts`, `src/types/index.ts` (`Note`), `src/components/notes/*`, `src/mobile/notes/*`, `src/lib/{noteUtils,noteTitle,noteStatus,notePreviewText,noteRecency,finalizeNote}.ts`.
- **Known original defects:** Verse-note anchor is verse-level only; no word-range anchor.
- **Native Mac / iPhone:** 🟡 / 🟡 — General and verse notes create/edit; Today’s Note and the Calendar open daily notes on both platforms.
- **Native files:** NotesViews.swift, AppModel+Workspaces openTodayDailyNote
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N02 Markdown model and ProseMirror structure
- **Original (both):** Notes are stored as markdown; the editor is ProseMirror (Typora-like rendered mode, with a raw-edit toggle, "Edit/View mode"); markdown → PM via markdown-it with custom rules, PM → markdown via custom serializer; custom nodes and marks.
- **Mac vs iPhone (original):** iPhone uses the same PM editor in WKWebView (`NoteEditorPage`, `phoneEditorChrome`, `PhoneSelectionToolbar`, `iosTextInput.test.tsx`).
- **Original files:** `src/components/notes/pm/{schema,parser,serializer,markdownIt,NoteEditorPM(1587),keymap,inputRules,slashCommands,pastePlugin,nodeViews,blockHandles,blockDecorations,headingCollapse,threadNodeView,…}.ts(x)`, `src/lib/noteTextBlocks.ts`.
- **Known original defects:** Non-standard markdown extensions make notes only partially portable (Octarine renders some, not all — INFERRED). Raw/rendered toggle named "markdown" in docs but "Edit/View" in commands.
- **Native Mac / iPhone:** 🟡 / 🟡 — Live-preview editor over verbatim Markdown (ADR-0014) — no data loss by construction; structures shown simplified
- **Native files:** RichNoteEditor.swift, RichNoteEditorIOS.swift, MarkdownLiveSpans.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N03 Inline formatting and block types
- **Original (both):** Bold/italic/code/strike/underline, coloured highlight marks, text alignment (paragraph attr), lists incl. tasks, quotes, callouts, code blocks with highlighting, horizontal rules, heading collapse (persisted per note), thread blocks with collapse (persisted), columns, slash commands, block handles/menu, selection toolbar, link editor, word/selection stats.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/*`, `src/lib/noteTextBlocks.ts`, `bereanMigrations.ts` v24/v27 collapse tables.
- **Known original defects:** Alignment is PM attr, stored how in markdown? UNVERIFIED (not read).
- **Native Mac / iPhone:** 🟡 / 🟡 — Bold/italic/underline/strike/highlight/code/headings/quotes/callouts/lists/tasks render; commands ⌘B/I/U etc. Format menu supports inline styles, headings, lists, and six named highlight colors. Existing legacy highlight colors render in the native editor. List continuation and checkbox toggling are implemented. Live checklist QA and slash command parity remain open.
- **Native files:** RichNoteEditor.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N04 Tables
- **Original (both):** GFM tables via prosemirror-tables with table status bar and column controls.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/{tablePlugins,tableStatusPlugin,columnControls}.ts(x)`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Markdown tables support insertion, row and column add/delete, whole-table deletion, keyboard cell navigation, and iPhone cell controls in the edit menu and above the software keyboard. Mac whole-table deletion, undo, redo, and note reopening passed live QA. Complete tables render with a header fill and cell borders in the Notes body font. Insertion and undo/redo passed on the iPhone simulator. Previously malformed iPhone separators are recognized without changing stored Markdown. Wide tables and broader editing QA remain open.
- **Native files:** RichNoteEditor.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N05 Images and attachments
- **Original (both):** Paste/drop/pick images; drag-resize; stored INLINE as base64 `data:` URLs inside `notes.content`; native Mac image menu (copy, save as, delete); iPhone photo-library insert (`NSPhotoLibraryUsageDescription`); vault export extracts to `{vault}/attachments/<hash>.<ext>` and import re-inlines.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/imageInsert.ts`, `nodeViews.ts`, `electron/ipc/noteImages.ts`, `electron/ipc/vault.ts` (`extractInlineImages` line 257, `inlineVaultImages` 307).
- **Known original defects:** Inline base64 inflates DB, FTS, sync journal ops (full `fields` per upsert) and version snapshots (INFERRED); perf doc mentions a 452 KB image note and +25 MB footprint once. No general attachment type (PDF files are separate, see U-PDF).
- **Native Mac / iPhone:** 🟡 / 🟡 — Inline data: images render with captions and saved width (2026-11-20, NOTE-IMAGES-2026-11-20.md); Mac drag-resize handle; insert/paste/resize UI, remote and attachment files open (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N06 Links, wikilinks and Scripture references
- **Original (both):** `[[Genesis 1:1]]` and `[[Note Title]]` wikilinks, auto-detected bare references decorated live, autocomplete popups (book/chapter/verse, notes), `berean://` links in notes, reference chips, timestamps links, backlinks-ish "cross refs from notes" for verses.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/pm/{autocomplete,AutocompletePopups,refDecorations,linkModel,LinkEditor}.ts(x)`, `src/lib/{noteRefs,notesCrossRefs,deepLinks}.ts`, `src/components/notes/MarkdownReferenceModal.tsx`.
- **Known original defects:** Display book labels vs canonical names (Hermas, roman numerals) can drift in titles; vault wikilinks are folder-unaware (memory: M6 issue list, fix status UNVERIFIED).
- **Native Mac / iPhone:** 🟡 / 🟡 — Links, wikilinks, bare Scripture references and explicit Strong’s numbers are linked in the native editors. Note-title completion includes a passage/excerpt preview. Plain Scripture and Strong’s block suggestions passed Simulator insertion and Undo checks. Cross-chapter blocks and Mac runtime verification remain open.
- **Native files:** NotesViews.swift, RichNoteEditor.swift, RichNoteEditorIOS.swift, NoteReferenceCompletion.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N07 Autosave
- **Original (both):** Desktop debounces 500 ms (NotesPanel; `registerPendingSaveFlusher` for floating windows); iPhone `useNoteAutosave` 500 ms debounce, version snapshot after 2 idle minutes and on leave, flush on pagehide/background/unmount; external changes preserved via `decideExternal`/`preserveExternal` while editing (`liveNote.ts`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{pendingSaves,notes/liveNote}.ts`, `src/mobile/notes/useNoteAutosave.ts`, `src/components/notes/NotesPanel.tsx`.
- **Known original defects:** Data-loss windows exist between keystroke and 500 ms flush and during force-quit (INFERRED); the editor owns the live doc and is not refreshed per save (documented fix).
- **Native Mac / iPhone:** ✅ / ✅ — 600 ms autosave + snapshots on idle/leave/close
- **Native files:** NotesViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N08 Undo/redo and version history
- **Original (both):** PM history for in-editor undo/redo; persistent `note_versions` snapshots (auto kind, pruned) with restore UI.
- **Mac vs iPhone (original):** —
- **Original files:** `notesService` (`createVersion`, `pruneNoteVersions`, `getVersions`, `restoreVersion`), `src/components/notes/NoteVersionHistory.tsx`, `prosemirror-history` in `keymap.ts`.
- **Known original defects:** Undo stack is in-memory; lost on reload.
- **Native Mac / iPhone:** ✅ / 🟡 — Version history sheet with a compact iPhone selector and full-width preview; restore with pre-restore snapshot (golden); undo via text system
- **Native files:** NotesViews.swift NoteVersionHistoryView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N09 Export, import, print
- **Original (both):** Per-note markdown export/import with frontmatter (`noteToMarkdownFile`), Files/share export on iPhone, Mac print preview and PDF export (main-process `printToPDF`), iPhone print via `UIPrintInteractionController` + PDF renderer, idioms export, vault export/import (N10).
- **Mac vs iPhone (original):** Mac sandbox build; iPhone share sheet.
- **Original files:** `src/lib/noteMarkdownFile.ts`, `src/platform/ios/exportNotes.ts`, `electron/main.ts` (`app:printNote`, `app:exportNotePDF`, `app:renderPreviewPDF`), `src/components/notes/PrintPreviewModal.tsx`, `BereanPrintPlugin.swift`, `src/lib/{notePreviewRender,idiomsExport}.ts`.
- **Known original defects:** Two serializers can drift.
- **Native Mac / iPhone:** ✅ / 🟡 — Markdown export, import and copy; system note printing with formatted Markdown. System print preview verified on Mac and iPhone Simulator; Files and multipage output checks remain.
- **Native files:** NoteFileTransfer.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N10 Vault integration (Octarine/Obsidian)
- **Original (both):** Optional vault folder: one `.md` per note with frontmatter and `berean_id`, attachments extraction, trash folder mirror, chokidar watcher (1.5 s polling, depth 10) with bidirectional reconcile, export-all and import-all on a timer and at quit, highlights/history/PDFs exported into the vault (`.attachments/`), hidden-path filter (`.git`, dotfiles).
- **Mac vs iPhone (original):** iPhone has NO vault (`R140`); it exports/imports single `.md` files via Files/share instead.
- **Original files:** `electron/ipc/vault.ts` (1449 lines), `electron/mac/folderAccess.ts` (security-scoped bookmarks for MAS), `src/components/shell/Onboarding.tsx` vault step, `src/components/settings/sections/ImportSection.tsx`.
- **Known original defects:** Known historic issues (memory M6/M7: bidirectional sync, wikilink folder-awareness, collisions): fix status UNVERIFIED. An iCloud-evicted file hang was found 2026-09-22 (memory) with sync `readFileSync` in `vault:reconcile`; mitigation status UNVERIFIED. The integration test is a tautology (X7).
- **Native Mac / iPhone:** ❌ / — — Vault sync not ported (M7-03)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N11 Folders, trash, pin, status, icons, board, list views
- **Original (both):** Folder tree (nested), soft-delete trash with restore/purge, pin, status chips, note icons/emoji picker, list/folder/board views, filters/sorting, AI exclusion at note or folder level, recents.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/notes/{NotesHomePanel,NotesFolderView,NotesBoardView,NotesList,NoteContextMenu,NoteIcon*,NoteStatusDropdown,folderTreeGeometry}.tsx`, `src/mobile/notes/{NotesHomePage,VirtualNoteList,TrashPage,FolderPicker,notesHomeModel}.ts(x)`, `notesService` folder functions.
- **Known original defects:** Folder delete cascades (`folderDeleteDeep`) rely on sync `dependents`.
- **Native Mac / iPhone:** 🟡 / 🟡 — Notes supports folder navigation, List/Gallery, sort/group, bulk selection/share, pin/trash/restore and scoped search. Gallery opening and return passed on Mac and iPhone simulator. Layout and All Notes location survived relaunch on both platforms. Collapsible sections and hidden-selection counts are implemented and runtime checked on Mac and simulator. Board and broader accessibility QA remain.
- **Native files:** NotesViews.swift NotesHomeView
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N12 Daily notes, calendar and sunrise day boundary
- **Original (both):** Daily note per date titled `Daily — YYYY-MM-DD` (title is a de facto key); day boundary at local sunrise via `suncalc` plus location (location once per launch); Sabbath label for Saturday; calendar widget with week view (Mac sidebar), calendar tab (both), continuous daily scroll, today shortcut (Cmd+Shift+D, intent, widget, `berean://daily`).
- **Mac vs iPhone (original):** Mac uses Electron geolocation path in main (INFERRED: `NSLocationWhenInUseUsageDescription` in `extendInfo`); iPhone plugin.
- **Original files:** `src/lib/{dailyNotes,dailyNoteUtils,calendarModel,noteUtils}.ts`, `src/components/notes/{CalendarWidget,CalendarTabPanel,ContinuousDailyScroll,DailyNoteEditsSection}.tsx`, `src/mobile/calendar/*`, `BereanLocationPlugin.swift`, `suncalc`.
- **Known original defects:** Location denied fallback to midnight (INFERRED); title-as-key means renames could break daily detection.
- **Native Mac / iPhone:** 🟡 / 🟡 — Both apps have month and week grids, direct month/year navigation, and a scrollable daily-note timeline with previews and calendar return. Date-to-note navigation uses the legacy keys. Today supports sunrise using an optional locally stored location, with a midnight fallback.
- **Native files:** AppModel+Workspaces
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N13 Idiom / reference-book editor
- **Original (both):** Idiom notes with structured fields (meaning, aliases, auto variants, examples), verse-row idiom hover/menu, idioms export.
- **Mac vs iPhone (original):** —
- **Original files:** `src/types/index.ts` (`IdiomData`), `notesService.listIdioms`, `src/lib/idiomsExport.ts`, `VerseRow.tsx`, `BibleRightPanel.tsx`, `SettingsModal.tsx`.
- **Known original defects:** Not in CLAUDE.md. 8. `idiomsExport.test.ts`. 9. SW-DATA. 10. Easy to forget. 11. C-DATA.
- **Native Mac / iPhone:** 🟡 / 🟡 — Idiom notes with header editor; Mac reader underline + click + meaning tooltip, reference-book export (2026-11-20, IDIOMS-2026-11-20.md) (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N14 BibleGateway notes importer
- **Original (both):** Logs into BibleGateway in a hidden Chromium window with user-supplied credentials and scrapes notes into a review list, then imports selected notes. CLAUDE.md §20 lists it as deferred.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/bgImport.ts` (820 lines), `src/components/settings/BibleGatewayImporter.tsx`, `BgImportProgress.tsx`.
- **Known original defects:** Scrapes a third-party site (ToS risk, fragile selectors); handles passwords in the main process memory; whether credentials persist anywhere is UNVERIFIED (partition declared ephemeral in a comment).
- **Native Mac / iPhone:** ❌ / — — BibleGateway importer (Mac) not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### N15 e-Sword import
- **Original (both):** Reads an installed e-Sword notes database and imports with review.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/eSwordImport.ts` (543), `src/components/settings/ESwordImporter.tsx`. 3. better-sqlite3 on a user file; home-directory search. 4. e-Sword files. 5. maps to `type: esword`. 6. Mac only. 7. Home-dir probing is sandbox-hostile in MAS (INFERRED). 8. none found. 9. SW-DATA with `sqlite3` an
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / — — File → Import from e-Sword… with review (2026-11-20, ESWORD-IMPORT-2026-11-20.md) (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H01 Storage
- **Original (both):** `highlights` table, id `hl-<textId>-<bookId>-<chapter>-<verse>-<range>` where range is `v`, `w<start>-<end>` or `c<start>-<end>` (deterministic so two devices highlighting the same range merge); older rows keep random ids; `label` column exists but no service API sets it.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/highlightsService.ts`, `electron/ipc/highlights.ts`, `bereanMigrations.ts` v1/v2.
- **Known original defects:** `label` is dead schema. `remove()` deletes ALL highlights on a verse with a bulk event.
- **Native Mac / iPhone:** ✅ / ✅ — Highlights service golden-verified
- **Native files:** HighlightsService.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H02 Verse, word and selection highlights; offsets and anchoring
- **Original (both):** Whole verse, word-range (start/end word index) and char-range (start/end char into plain `verse.text`) highlights; overlapping allowed; row tint for verse-level.
- **Mac vs iPhone (original):** —
- **Original files:** `highlightsService.ts`, `VerseRow.tsx`, `src/lib/{scriptureHighlight,verseUtils}.ts`, `src/mobile/study/VerseActionSheet.tsx`.
- **Known original defects:** No re-anchoring after data fixes (e.g. the Enoch row splits, KJV italics re-seed) — INFERRED risk; legacy word-level rows use word index into tagged tokens, a second coordinate system.
- **Native Mac / iPhone:** 🟡 / 🟡 — Both readers map text selections into existing stored character offsets. Mac partial selection previously verified; iPhone write/reopen needs touch QA.
- **Native files:** ChapterTextView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H03 Colours and categories
- **Original (both):** 15 colours (`HighlightColor` in `src/types/index.ts`) incl. yellow, red, green, blue, purple, orange, pink, teal, cyan, indigo, lime, amber, rose, violet, sky; no categories/labels UI; CLAUDE.md's 5 colours and "label/tag" are outdated/unused. Verse tags (S18) are the categorisation mechanism instead.
- **Mac vs iPhone (original):** —
- **Original files:** types, `ColorSwatchRow.tsx`. 3–6 trivial; `electron.d.ts` still declares a 5-colour union (type drift, VERIFIED). 7. Type drift in `electron.d.ts`. 8. none specific. 9. SW-UI. 10. Low. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — 5 colours
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H04 Note and tag indicators on verses
- **Original (both):** Dots/badges per verse for notes (count), highlights, tags, cross-refs; click opens notes popover; chapter-notes banner.
- **Mac vs iPhone (original):** —
- **Original files:** `VerseRow.tsx`, `verseNotesAggregate.ts`, `chapterNotes.ts`, `notesService.getChapterCounts/getByChapter`, `src/mobile/study/{VerseNotesSheet,ChapterNotesView}.tsx`. 3. batch queries per chapter. 4. none. 5. `hasNote`, `hasHighlight` flags on `Verse`. 6. iPhone sheet. 7. CLAUDE.md "dot position sett
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Note dots + tag chips (Mac); iPhone note dots, tag chips in rows
- **Native files:** ChapterTextView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H05 Cross-translation highlights
- **Original (both):** Highlights are keyed by `text_id` and fetched per `(textId, book, chapter)` (`ChapterView.tsx:709`). No setting or mapping carries them across translations. Offsets would not transfer between texts anyway.
- **Mac vs iPhone (original):** —
- **Original files:** `highlightsService.getChapter`. 3–6 n/a. 7. Absence VERIFIED by grep. 8. none. 9. New design needed (anchor by Strong's/word alignment). 10. Don't assume parity. 11. n/a.
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Deferred in original
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### H06 Highlight sync
- **Original (both):** `highlight` is a synced entity (deterministic ids).
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/sync/entities.ts` (`tableEntity({kind:'highlight'})`). 3. journal. 4–6 X6. 7. Vault export writes highlights as markdown previews, one-way. 8. `engine.integration.test.ts` etc. 9. SW-DATA. 10. Sync port is the hard part. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — No native sync (M4)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U01 Spaces
- **Original (both):** Five spaces: scripture, notes, lexicon, youtube, search; each with its own tab list; iPhone shows tab types in a switcher, history/settings/calendar as tabs.
- **Mac vs iPhone (original):** —
- **Original files:** `src/types/index.ts` (`SpaceId`, `TabType` adds pdf, tags, history, settings, calendar), `Sidebar.tsx` (856), `src/mobile/navigation/{BottomNav,experiences,TabTypeSwitcher}.ts(x)`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Spaces as tab types, ⌘1–5
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U02 Vertical tabs, sessions, archive
- **Original (both):** Arc-style vertical tab lists, sessions (named tab groups), archived groups, MRU, auto-close, move/duplicate/rename/close others, drag reorder (Mac), tab grid cards (iPhone), saved workspaces.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/shell/{Sidebar,TabBar,TabSwitcher,SessionSwitcher}.tsx`, `src/components/ui/TabStrip.tsx`, `src/mobile/tabs/*`, `src/store/{index,tabPersistence,tabPersistenceRuntime}.ts`, `sessionsService.ts`.
- **Known original defects:** Large store coupling; `tabPersistenceRuntime` exists to reconcile store↔DB.
- **Native Mac / iPhone:** ✅ / ✅ — Unified Workspaces (ADR-0011), archive, ordered tab list
- **Native files:** Sidebar.swift, AppModel+TabList.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U03 Pinned tabs
- **Original (both):** `Tab.isPinned` is persisted (`tabs.is_pinned`), synced, and respected by close actions/labels on iPhone, but no code anywhere sets it true (grep of `isPinned:` assignments finds only the readers/serialisers). No pin UI on either platform. (Note pinning is separate and works: `Note.pinned`.)
- **Mac vs iPhone (original):** —
- **Original files:** `src/types/index.ts:315`, `tabPersistence.ts:191`, `tabFields.ts:139`, `src/mobile/tabs/TabCardsSheet.tsx`, `TabList.tsx`. 7. dead capability. 8. none. 9. Decide before port. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Pin/unpin + drag into Pinned (native adds setter)
- **Native files:** Sidebar.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U04 Tab and session persistence
- **Original (both):** Tabs/sessions hydrate from SQLite rows at startup, Zustand persisted to localStorage (debounced 5 s via `debouncedStorage`), flushed before quit/background.
- **Mac vs iPhone (original):** —
- **Original files:** `src/store/{tabPersistence,tabPersistenceRuntime}.ts`, `src/lib/debouncedStorage.ts`. 3. dual persistence (localStorage + DB mirror). 4. none. 5. `TabRow` with `local_state_json` excluded from sync. 6. same. 7. Two stores of truth for tab structure (INFERRED risk). 8. `tabPersistence.test.ts`, `tabP
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Synced sessions/tabs tables, relaunch restore
- **Native files:** SessionsService
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U05 Workspaces and layouts
- **Original (both):** Saved workspaces (layout + tab snapshot, named "Saved sessions" in UI); 16 Scripture layouts (mosaic trees) with LayoutPicker; per-window layout state.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/bible/LayoutPicker.tsx`, `src/components/shell/PanelLayout.tsx` (react-mosaic-component), `src/lib/workspaceSnapshot.ts`, `workspacesService.ts`, `WorkspacesSection.tsx`, `src/mobile/tabs/WorkspacesPage.tsx`.
- **Known original defects:** CLAUDE.md says 6 presets, code has 16. 8. `workspaceRestore.test.ts`, `workspacesService` contract test not found (`workspacesService` has no contract test in the list — VERIFIED absence). 9. SW-UI (`NSSplitView`/`NavigationSplitView` or custom pane manager). 10. Resizable pane layout engine has no 
- **Native Mac / iPhone:** ✅ / 🟡 — 16 layouts (Mac); saved workspaces both
- **Native files:** ScriptureLayouts.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U06 Resizable panels, drag and drop
- **Original (both):** Mosaic dividers, panel resize handles, right-panel width, tab drag between spaces/sessions, note drag to folders, block drag in editor.
- **Mac vs iPhone (original):** —
- **Original files:** `ResizeHandle.tsx`, `PanelLayout.tsx`, `Sidebar.tsx`, `NotesFolderView.tsx`, `blockHandles.ts`. 3. DOM drag events/react-mosaic. 4. HTML5 DnD. 5. layout JSON. 6. iPhone uses long-press/sheets. 7. none specific. 8. `blockHandles*.test.ts`, `folderTreeGeometry.test.tsx`, `inspectorLayout.test.ts`. 9. 
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / — — Split panes; no drag tabs into panes
- **Native files:** ScriptureLayouts.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U07 Multi-window, floating panels, presenter/viewer
- **Original (both):** Synced peer windows, independent windows, floating tab windows, floating hover panel/rail, verse-picker window, Berean Chat window, Study Trail window, presenter/viewer window mirroring the main Bible panel (scroll fraction, outline band, content/settings sync).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/main.ts` (window creators ~lines 789–1134), `src/lib/{crossWindowSync,floatingTab,perWindowViewState,presenterBand,presenterOverlay,windowChrome}.ts`, `src/hooks/useViewerSync.ts`, `src/components/viewer/*`, `src/components/bible/PresenterOutline.tsx`, `src/components/shell/{FloatingShell,
- **Known original defects:** Heavy debug instrumentation hooks (`window.__bereanPresenterDebug`). Pending-save flush when returning a floating tab (`flushPendingSaves`).
- **Native Mac / iPhone:** 🟡 / — — New Window + Presenter (⌘⇧B), rendered pause snapshots, rich notes, reader filters and scoped Close behavior; actual bounded UI checks in PRESENTER-MESSAGES-POLISH-2026-11-20.md. Laser/compare/side panel/floating tabs and full focus/zoom matrix open (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U08 Navigation state and history stacks
- **Original (both):** Per-tab back/forward stacks, origin-tab return, scroll resets, "Study Trail" integration on navigation; `navigateToVerse` single entry point with `NavOrigin`.
- **Mac vs iPhone (original):** —
- **Original files:** `src/store/index.ts`, `src/lib/verseNavigation.ts`, `src/lib/navigation/*`, `docs/navigation-contract.md`, `src/mobile/navigation/*`. 3. store actions. 4. none. 5. `TabNavEntry`. 6. iPhone edge-swipe. 7. contract doc must be kept in sync. 8. `perTabHistory.test.ts`, `originTabReturn.test.ts`, `fresh
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / 🟡 — Per-tab history; [sidebar ‹ ›] group (Mac); iPhone Back/Forward in More
- **Native files:** MacRootView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U09 Menus, context actions, commands
- **Original (both):** Native macOS app menu built in main (`buildAppMenu`) with actions dispatched to renderer as custom events; command palette list (30 commands); native image menu; iPhone caret command sheet.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/main.ts` (line 376), `src/lib/commands.ts`, `src/mobile/commands/*`, `src/App.tsx`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Menus/context menus partial; no Commands group in ⌘K
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U10 Keyboard shortcuts
- **Original (both):** Global handler in `App.tsx` (19 meta-key references) plus panel-local handlers; shortcut list shown in Onboarding and Settings (read-only); CLAUDE.md table (Cmd+1–5, Cmd+Shift+L, etc.) is only partly verified.
- **Mac vs iPhone (original):** —
- **Original files:** `src/App.tsx`, `src/lib/commands.ts`, `src/components/shell/ShortcutKeys.tsx`, onboarding `StepShortcuts`. 3. keydown handlers. 4. none. 5. n/a. 6. Mac only; iPad deferred. 7. No shortcut editing (documented deferred). Individual shortcut parity with CLAUDE.md UNVERIFIED. 8. `menuKeyNav.test.ts`, `k
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / — — Core shortcuts; no shortcuts list in Settings
- **Native files:** BereanMacApp.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U11 Themes and appearance
- **Original (both):** 38 theme presets (family-grouped, light/dark variants, optional ambient animation), custom themes, contrast helpers, accent colour from system, reduce-transparency/increase-contrast hooks, Liquid Glass on Mac (native addon) and iPhone (plugin), design-system doc.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{themePresets,customTheme,applyTheme,contrast}.ts`, `src/components/settings/{ThemePicker,ThemePreviewCard}.tsx`, `src/platform/liquidGlass/*`, `native/mac-liquid-glass/berean_glass.m`, `BereanGlassPlugin.swift` (492 lines), `docs/{design-system,liquid-glass}.md`.
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — System/light/dark; dark mode visually checked on Mac reader/search
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U12 Settings
- **Original (both):** Settings modal (Mac) with ~16 sections (Display, Texts, Layout, Notes, YouTube, Audio, iCloud, Updates, History, Print/Export, Sessions, Workspaces, Import, Word replacer, Ask Berean/Local models, Experimental, About, Danger) and iPhone pages.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/settings/*`, `src/mobile/settings/*`. 3. store-backed switches; `settings` table. 4. none. 5. `settings(key,value JSON)`; many prefs only in localStorage. 6. different pages. 7. SettingsModal is a very large monolith (INFERRED). 8. `settings/sections/__tests__` exists; `settingsServi
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Reading, Appearance, Workspaces, Library. Includes preferred Shepherd of Hermas edition. Text ordering and other settings sections remain open.
- **Native files:** SettingsView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U13 Onboarding and hints
- **Original (both):** First-run wizard (welcome, translation, vault, import, Ask Berean model step, shortcuts, done); iPhone 4-page flow incl. iCloud opt-in. CLAUDE.md's per-feature hint tooltips with "Don't show again" are not present (grep for hint/dismiss state finds none).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/shell/{Onboarding,OnboardingModelStep}.tsx`, `src/mobile/onboarding/*`, `TasksPanel.tsx` (first-steps checklist, Mac only). 3. flags in store. 4. none. 5. `onboardingCompleted`. 6. different flows; no Tasks panel on iPhone. 7. Hints absent. 8. `Onboarding.maybeImportVault.test.ts`, `
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Getting started flow + replay; TipKit hints (Search, PiP, Ask follow-up) with Reset Hints (2026-11-20, ONBOARDING-2026-11-20.md); reader/editor hints open (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U14 Study Trail
- **Original (both):** Records navigation as a graph (sessions, nodes, connections), reason-prompt popovers on chapter jumps, arrival prompt eligibility rules, map/threads/everything/search views, sticky notes, tags, merge/split, recap, embeds in notes (`study_trail_embed` node), own window (Mac) and page (iPhone, hosting the desktop views).
- **Mac vs iPhone (original):** —
- **Original files:** `src/store/studyTrailSlice.ts` (1091), `src/platform/services/studyTrailService.ts` (1223), `electron/ipc/studyTrail.ts`, `src/components/studyTrail/*` (MapView, StudyTrailApp, …), `src/lib/studyTrail/arrivalEligibility.ts`, `src/mobile/trail/*`, migrations v28–40.
- **Known original defects:** Several `stub` mentions inside trail components (grep) — INFERRED placeholders. Not in CLAUDE.md.
- **Native Mac / iPhone:** 🟡 / 🟡 — Trail browsing, manual recording, lifecycle, editable stop and connection notes, explicit connections, and a navigable branch map using the legacy tables. Opt-in automatic chapter recording uses the original 1.2-second dwell. Automatic connections capture cross-reference jumps and inline Strong’s lookups. Search and manual ordering are available in the library. Trail Actions supports creating, assigning and removing tags from a trail, and tag names are searchable. A Sticky Notes sheet supports editing annotations and section headers and shows their anchor chapter. The map places saved section headers and annotations beside their stops. Context menus move notes between stops or remove their anchor. Sticky titles and bodies are searchable in the library and trail. Connection classification, prompts, and the full graph workspace remain open.
- **Native files:** StudyTrailView.swift, StudyTrailService.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U15 Tasks panel and first steps
- **Original (both):** Checklist of first steps. 2. `src/components/shell/TasksPanel.tsx`. 3–5 trivial. 6. no iPhone equivalent (VERIFIED: only desktop references). 7. none. 8. none. 9. SW-UI. 10. Low. 11. C-HOST.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Getting Started checklist with original completedStepIds + native detection, on both platforms (2026-11-20) (synced with the table row 2026-11-20)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U16 Tags and tag graph
- **Original (both):** Verse tags (named, coloured, member refs as spans), chapter-tag narrowing, tag manager, tag graph with force layout, edges with editor, co-occurrence, search by tag, tagged verse browsing.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/{verseTagsService,tagGraphService}.ts`, `electron/ipc/{verseTags,tagGraph}.ts`, `src/components/tags/*`, `src/lib/{tagPalette,verseTagRanges,verseTagSearch,tagRefScan}.ts`, `src/mobile/study/TagPickerSheet.tsx`. 3. members expanded to `verse_tag_verse` index (rebuilt on sync a
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Verse tags (golden), chips, picker, #tag search, Tag Manager, and Tag Graph (see [TAG-GRAPH-2026-11-20](TAG-GRAPH-2026-11-20.md)).
- **Native files:** VerseTagsService.swift, TagGraphService.swift, TagForceLayout.swift, VerseTagViews.swift, TagManagerView.swift, TagGraphView.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U17 PDFs
- **Original (both):** Library with import (dialog on Mac; file input on iPhone), pdf.js viewer, find bar, highlights, bookmarks, outline, copy-link `berean://pdf/<id>/<page>`; metadata synced, bytes not; Mac files in `userData/pdfs/<id>.pdf`; iPhone `Library/Berean/pdfs`. Feature-flagged (`pdfFeatureEnabled`, Settings → Experimental).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/pdf/*`, `electron/ipc/pdf.ts`, `src/platform/services/pdfService.ts`, `src/lib/pdfjs.ts`, `src/platform/ios/bridgeExtras.ts` (`pdf`), iPhone `PdfLibraryPage` in `MobileApp.tsx`, Share Extension PDF intake.
- **Known original defects:** Bytes never sync (documented). 8. none for pdf components; `bereanMigrations` v11/v46 only. 9. SW-UI with PDFKit (`PDFView`) — a strong native fit; highlights via `PDFAnnotation`. 10. Highlight geometry must map from pdf.js text-layer coordinates to PDFKit selections (INFERRED, medium). 11. C-DATA.
- **Native Mac / iPhone:** 🟡 / 🟡 — Library (import/rename/delete/copy link, missing-file state + hash re-attach), PDFKit reader (page restore, highlights in the original normalised format, notes, bookmarks, outline, find, copy page link, Search Scripture from selection). See [PDF-READER-2026-11-20](PDF-READER-2026-11-20.md). Share Extension intake, `pdfFeatureEnabled` gate and bookmark-label editing remain.
- **Native files:** BereanNotes/PdfService.swift, PdfGeometry.swift, apple/Shared/PdfViews.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### U18 Berean Chat (notes-style chat)
- **Original (both):** A Messages-style notes/chat surface using `ai_chats` rows; list, days, conversations, folders, search, reply quotes, composer (ProseMirror), find in conversation, window or tab; iPhone page and Home Screen widget "New Message".
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/ailookup/*`, `src/mobile/chat/*`, `ios/App/BereanWidget/BereanChatWidget.swift`, `src/platform/services/aiChatsService.ts`, `docs/berean-chat.md`.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — conversations, Unfiled, pins/folders/replies/edit/delete, rich message rendering, search, per-conversation drafts and internal reference navigation implemented. Bounded Mac+iPhone interaction checks pass; failure/accessibility, original find/widget/standalone combinations remain open.
- **Native files:** `apple/Shared/ChatViews.swift`, `BereanNotes/ChatsService.swift`, `BereanNotes/ChatReferenceLinks.swift`. See [actual checks and limits](PRESENTER-MESSAGES-POLISH-2026-11-20.md).
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M01 YouTube browsing and playback
- **Original (both):** Mac: Electron `<webview persist:youtube>` for login/browse/watch, allow-listed channel feed (hard-coded `CHANNELS` array of 15+ handles in `electron/ipc/youtube.ts`), feed fetched by scraping channel pages (`executeJavaScript(EXTRACT_JS)` in hidden windows), search videos, stars, watch history, resume positions, 11 layouts with secondary panels (notes/scripture/lexicon beside video). iPhone: native `WKWebView` overlay (`BereanWebViewPlugin`) loading the embed from an https base because the embed refuses the `capacitor://` origin; IFrame API relays position and end.
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/youtube/{YouTubeTab(2763),YouTubeSecondaryPanel,TouchYouTubePlayer,TranscriptViewer}.tsx`, `electron/ipc/youtube.ts` (1428), `src/platform/services/{youtubeService,youtubeFetchService,youtubeIndexMerge}.ts`, `src/lib/{youtubeLayouts,youtubeSearch,youtubeTitle}.ts`, `BereanWebViewPlug
- **Known original defects:** Scraping is brittle and a ToS exposure; CLAUDE.md claims a user-editable allowlist with add-channel prompt, but channels are hard-coded (VERIFIED). WebKit blocks programmatic PiP without a user gesture (iPhone doc). The `webviewTag: true` line carries a stale comment saying it is disabled in MAS.
- **Native Mac / iPhone:** 🟡 / 🟡 — WebKit YouTube tab (channels, browse, inline watch, state `{videoId,url}` persisted, Copy Timestamp/Video Link, Insert into open note in the original Markdown format). Missing: in-app feed scraping, split panels, transcripts, PiP automation.
- **Native files:** `apple/Shared/YouTubeTabView.swift`
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M02 Picture-in-Picture
- **Original (both):** Mac auto-PiP: when leaving the YouTube space with a playing video and `autoPiP` on, `webview.executeJavaScript` calls `video.requestPictureInPicture()`; returning exits it; Cmd+Shift+P toggles; tested only manually. `PiPController.tsx` is a dead stub returning null ("Phase 4 stub") — abandoned file. iPhone: system PiP only from the native player's fullscreen controls (no auto-PiP).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/youtube/{YouTubeTab.tsx (~1099–1140),PiPController.tsx}`, `src/store/index.ts` (`autoPiP`). 3. DOM PiP API inside the embedded page. 4. Chromium/WebKit. 5. setting `autoPiP`. 6. as above. 7. depends on YouTube page DOM. 8. none. 9. `AVPictureInPictureController` over an `AVPlayer` is
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M03 Video-linked notes and timestamps
- **Original (both):** Insert `[Title — mm:ss](https://youtu.be/ID?t=N)` into the active note (Cmd+Shift+L on Mac; "Insert video timestamp" action on iPhone), notes beside video, `berean://video/<id>?t=` deep links, transcript click seeks.
- **Mac vs iPhone (original):** —
- **Original files:** `YouTubeTab.tsx` (`insertTimestamp` ~1487), `NoteEditorPM.tsx` listener, `deepLinks.ts`, `NoteEditorPage`. 3. window events `berean:requestTimestamp`/`berean:insertTimestamp`. 4. none. 5. markdown link text. 6. both. 7. CLAUDE.md timestamp-format setting not found. 8. `deepLinks.test.ts`, `deepLinkD
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M04 Transcripts and transcript search
- **Original (both):** Transcripts for allow-listed channels are fetched in dev builds only (`fetchTranscripts`/`clearTranscripts` gated by `is.dev` and `devToolsEnabled`), baked into `youtube_seed.db`, shipped read-only; FTS5 over transcript segments; synced transcript viewer with seek; iPhone downloads per-channel transcript packs (resumable, SHA-256 verified via `BereanDownloadsPlugin`) and merges them into the local DB.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/{youtube,youtubeTranscriptCore}.ts`, `scripts/export-transcript-seed.js`, `scripts/data/split-youtube-seed.mjs` (referenced), `src/mobile/youtube/{transcriptPacks.ts,TranscriptPacksPage.tsx}`, `BereanDownloadsPlugin.swift`, `youtubeIndexMerge.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M05 Read Aloud engine (Kokoro)
- **Original (both):** Chapter/passage speech with Kokoro-82M (ONNX q8) in a Web Worker on Mac; chunking by sentences, audio cache (`tts-audio-cache` PCM + LRU index), pitch-preserving playback rate via `HTMLAudioElement.preservesPitch`, voice picker with tiers, queue/playlists, progress bar, cross-window sync, auto-advance. iPhone: native ONNX Runtime synthesis (`BereanVoicePackPlugin.synthesize`, `onnxruntime-swift-package-manager` 1.24.2) with voice pack download, plus the curated Apple voices fallback (`BereanSpeechPlugin`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/tts/{ttsEngine,ttsBackend,textPrep,extractSpokenText,nativeSpeechBackend}.ts`, `src/lib/tts/kokoro/*`, `src/hooks/{useTTSPlayback,useKokoroModelDownload}.ts`, `src/components/audio/*`, `electron/ipc/{ttsModel,ttsAudioCache}.ts`, `electron/{ttsModelManifest,ttsModelProtocol}.ts`, `src/mobile
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Read Aloud remains open. Owner requires original Kokoro/Berean Voices quality and rejected Apple voices on 2026-11-17.
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M06 Audio playback, seeking, queue and background
- **Original (both):** Pause/resume, rate, skip verse, queue popover, saved playlists with autosave of the queue (800 ms debounce), sleep timer (iPhone), chapter progress bar seeking, lock-screen Now Playing and remote commands via `BereanAudioPlugin` (`.playback` category, `UIBackgroundModes: audio`).
- **Mac vs iPhone (original):** —
- **Original files:** `src/components/audio/*`, `src/hooks/useQueueAutosave.ts`, `src/mobile/audio/{AudioBar,AudioSheet,QueuePage,audioControls,followState,sleepTimer,useIosAudioSession}.ts(x)`, `playlistsService.ts`. 3. store playback state; plugin events. 4. AVAudioSession/MediaPlayer. 5. `playlists`, `playlist_items`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M07 Word-follow highlighting
- **Original (both):** Per-word highlight during playback by distributing each chunk's real audio duration proportionally over characters (`timestampAlignment.ts` header says Kokoro does not expose alignment; the timestamped model variant was not adopted); Apple voices use `boundary` events with char offsets.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/tts/kokoro/timestampAlignment.ts`, `nativeSpeechBackend.ts`, `VerseRow.tsx`, `src/mobile/audio/followState.ts`. 3. char-position map from tagged tokens (`taggedTokenCharPos`). 4. none. 5. n/a. 6. same. 7. Drift on long chunks (INFERRED from method). 8. `timestampAlignment.test.ts`, `audioFo
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M08 Voice downloads and caching
- **Original (both):** Mac: opt-in pack download into `userData/tts-models` (temp dir + atomic rename, size-verified), served to the worker via `berean-model://` protocol; iPhone: sequential file download to `Application Support/Berean/tts-models` with background task and manifest written last; audio cache LRU with size cap on Mac.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/ttsModel.ts`, `electron/ttsModelProtocol.ts`, `BereanVoicePackPlugin.swift`, `src/platform/ios/voicePack.ts`, `src/lib/tts/kokoro/{audioCacheStore,modelDownloadState}.ts`. 3. fetch/URLSession. 4. Hugging Face hosting. 5. manifest file list from `ttsModelManifest.ts` shared by both. 6. 
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### M09 Sleep timer (iPhone)
- **Original (both):** Read Aloud sleep timer with presets; stops playback at expiry.
- **Mac vs iPhone (original):** —
- **Original files:** `src/mobile/audio/sleepTimer.ts`, `AudioSheet.tsx`. 3. timer state in the audio sheet. 4. none. 5. none persisted (INFERRED). 6. iPhone only. 7. Only one file in `docs/` mentions it (grep). 8. `src/mobile/__tests__/audioSleepTimer.test.ts`. 9. SW-UI + `AVAudioPlayer`/engine stop. 10. Low. 11. C-HOST
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G01 Direct references and Strong's without a model
- **Original (both):** John-3:16-style references, Strong's ids, lexical studies (forms, glosses), word tables, occurrence counts, comparisons (e.g. two Strong's), follow-up resolution ("now only Greek", "the second") — answered from DBs with no model; keyword fallback labelled `NO_MODEL_INSTALLED`.
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/services/{modelFreeLookup,researchService}.ts`, `src/lib/research/{references,strongsId,lexicalIntent,compareIntent,compareWords,conversationState,exclusions}.ts`, `src/components/ailookup/{ComparisonView,ResearchResults}.tsx`.
- **Known original defects:** Intent detection is regex/heuristic; coverage limited to patterns tested.
- **Native Mac / iPhone:** ❌ / ❌ — Ask Berean not ported
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G02 Local model runtime (Ollama), model picker, downloads
- **Original (both):** Requires the user's own Ollama on `localhost:11434`; model list, pull with progress, cancel, remove, catalog of 5 models (qwen3.5:2b, gemma4:12b-it-qat, llama3.1, llama3.2:3b, ministral-3:3b) with tiers; Automatic ordering and memory-gated escalation for Deep Search; onboarding model step. The resumable SHA-verified downloader (`modelDownloader.ts`) is NOT wired (VERIFIED); pulls go through Ollama's `/api/pull`. No bundled runtime or model; a full new download was not tested (SPEC_STATUS).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/{ollama,modelGateway}.ts`, `electron/ipc/aiModels.ts`, `src/lib/research/{modelCatalog,modelChoice,modelRouting}.ts`, `src/components/settings/sections/LocalModelsSettings.tsx`, `OnboardingModelStep.tsx`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G03 Ask Berean modes (Commentary ON/OFF), prose stripping, premise check
- **Original (both):** Commentary OFF strips interpretive prose in the main process and shows references only; ON adds model commentary (prompt-level, adaptive depth); premise check and its notice; "interpretation offered" prompt; nonexistent-reference scrubbing (`removeNonexistentReferences`).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/aiLookup.ts`, `src/lib/research/{modePolicy,commentaryDepth,premise,outputGuard,policy}.ts`, `src/store/aiModeMigration.ts`, `src/components/ailookup/chatModes.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G04 Deep Search, escalation, cancel and time budgets
- **Original (both):** Multi-round retrieval with refine pass, automatic larger-model escalation (installed, local, Deep Search only, memory-gated: `chooseLocalModel(…, totalMemoryBytes)` verified), Stop/cancel via `ailookup:cancel` and `AbortSignal`, findings view; budgets are per-call timeouts only (120 s for large models); no per-question budget.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/ipc/aiLookup.ts` (`agentic` option, line ~2668/2691), `electron/modelGateway.ts` (cancellable, `LARGE_MODEL_TIMEOUT_MS = 120_000`), `src/components/ailookup/ResearchFindings.tsx`, `electron/tokenBudget.ts`.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / — — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G05 Collections, study profiles, saved contexts, memory
- **Original (both):** Collections (canon, apocrypha, pseudepigrapha, fathers, notes, etc.), study profiles (per-profile model, scope, mode, instructions) with Mac and iPhone UI, explicitly saved research contexts, cross-chat memory only by explicit save, profile instructions with no adversarial test set.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/research/{collections,studyProfile}.ts`, `src/platform/services/{studyProfilesService,savedContextsService}.ts`, `src/components/ailookup/{useStudyProfiles,profileActivation}.ts`, `src/mobile/chat/AskOptionsPage.tsx`, `src/mobile/settings/AskBereanSettingsPage.tsx`; migration v49.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G06 Verse-note influence and note exclusion
- **Original (both):** Notes can be excluded (note or folder) and are never used; an excluded note is never sent; verse notes add a fixed ranking boost and referenced verses feed retrieval; Mac only; "notes never outrank text"; injected-note scenario tested.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/research/noteExclusion.ts`, `aiLookup.ts`, `notesService.setAiExcluded/folderSetAiExcluded`, `docs/ai-upgrade/SPEC_STATUS.md` decisions 16/22.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G07 Cloud model (BYO key)
- **Original (both):** Anthropic only (`providers.ts` registers `id: 'anthropic'`); key saved via Electron `safeStorage` (Keychain-backed) into `provider-keys.json` (base64 ciphertext, 0600), never sent to the renderer; routing is explicit-opt-in (`cloudEnabled`, key + model set, policy allows, never as a response to local failure); private-context flag; mocks only — no real call was made (SPEC_STATUS: "Done, unverified by hand").
- **Mac vs iPhone (original):** —
- **Original files:** `electron/secrets/{providerKeys,providerSettings}.ts`, `electron/ipc/aiProviders.ts`, `src/lib/research/{providers,policy}.ts`, `src/components/ailookup/cloudSettingsUi` tests, `SUBSCRIPTIONS.md`.
- **Known original defects:** ChatGPT plan connection and general web search blocked on decisions (SPEC). Key format validation is length/whitespace only.
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G08 Online research (Wikipedia, Sefaria)
- **Original (both):** Keyless Wikipedia and Sefaria queries; only content words leave the device; results rendered as labelled cards, never fed to a model prompt; Commentary OFF shows title+link only; default off, ask, or automatic with Deep Search; implemented on both platforms; general web search blocked on a provider decision.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/research/webResearch.ts`, `electron/ipc/aiProviders.ts`, `src/platform/ios/{bridgeExtras,onlineResearchSetting}.ts`. 3. fetch via `net.fetch` (Mac) / CapacitorHttp (iPhone). 4. Wikimedia/Sefaria APIs. 5. `ExternalSource`. 6. iPhone real search in simulator only (SPEC). 7. Live API shape pro
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G09 Retrieval benchmark and evaluation harness
- **Original (both):** Case files, holdout (`HOLDOUT.lock`), retrieval eval and semantic eval scripts; SPEC says no fresh independent holdout so no new independent quality claim.
- **Mac vs iPhone (original):** —
- **Original files:** `scripts/eval/*`, `docs/ai-upgrade/*`. 3–5 offline; 6. Mac dev only. 7. Human-review page has no entries (SPEC). 8. harness itself is the test (`vitest.eval.config.ts`). 9. Rebuild eval in Swift test target or keep Node tooling. 10. Needed to prove parity. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Dev tooling
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### G10 iPhone Ask Berean (model-free)
- **Original (both):** On iPhone the Ask surface runs only the deterministic path (G01), profile/scope/mode screens, saved context, online research; no local model, no cloud model, no Deep Search (SPEC: "Partial; Local model blocked").
- **Mac vs iPhone (original):** —
- **Original files:** `src/mobile/chat/{ChatPage,AskOptionsPage}.tsx`, `src/platform/ios/bridgeExtras.ts` (`aiLookup`). 3. renderer. 4. none. 5. same chat rows. 6. see 1. 7. low-memory behaviour BLOCKED. 8. `chatController.test.tsx`. 9. SW-UI + services. 10. Foundation Models/MLX decisions. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A01 iCloud sync (journal)
- **Original (both):** See X6. Per-device folder under the ubiquity container (`Documents/sync/v1`), HLC-ordered ops, snapshots/compaction, conflict records, holds on account/container mismatch, identity isolation (prod vs dev containers).
- **Mac vs iPhone (original):** —
- **Original files:** `src/platform/sync/*`, `electron/sync/*`, `native/mac-icloud/berean_icloud.m`, `BereanCloudPlugin.swift`, `src/platform/ios/{cloudSyncStore,syncHost}.ts`, `src/components/settings/sections/ICloudSection.tsx`, `docs/mobile/{icloud,sync,icloud-lifecycle,data-safety}.md`.
- **Known original defects:** Real-iCloud device matrix pending (docs) — BLOCKED; engine tested with a simulator (`icloudDriveSim.ts`). Uses iCloud Drive files not CloudKit (no push; polling + metadata query). `1404`-line engine.
- **Native Mac / iPhone:** ❌ / ❌ — Sync engine port pending (M4, OD-5 gates)
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A02 Keychain / secure storage
- **Original (both):** Mac: `safeStorage` for BYO cloud keys only. No other secrets. `electron/youtube-key.ts` is a build-time gitignored file (YouTube Data API key) embedded in the app (value never read; whether bundled into the renderer is UNVERIFIED). iPhone: none.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/secrets/*`, `electron/youtube-key.example.ts`. 3–6 above. 7. Embedding an API key in a shipped binary is extractable (INFERRED). 8. `providerKeys.test.ts`. 9. Keychain Services. 10. Key migration impossible. 11. n/a.
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A03 App Groups and Share Extension
- **Original (both):** Share Sheet extension collects text (reference → open passage, other text → note), URLs (YouTube → video), PDFs into the App Group inbox then opens `<scheme>://share`; the app's `BereanShareInboxPlugin` hands items to the deep-link router.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/ShareExtension/{ShareViewController.swift,Info.plist,ShareExtension.entitlements}`, `BereanShareInboxPlugin.swift`, `src/platform/ios/shareInbox.ts`. 3. App Group container files. 4. App Group id from `$(BEREAN_APP_GROUP)`. 5. inbox JSON items. 6. iPhone only. 7. crash-safe inbox hardening 
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — Share Extension not built for native
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A04 Spotlight
- **Original (both):** Core Spotlight index of notes, sessions, workspaces, books and chapters; deep link ids; incremental on `data:changed`; verses not indexed.
- **Mac vs iPhone (original):** —
- **Original files:** `BereanSpotlightPlugin.swift`, `src/platform/ios/spotlight.ts`. 3. `CSSearchableIndex`. 4. CoreSpotlight. 5. identifier = deep link URL. 6. none on Mac. 7. none. 8. none found. 9. Already native Swift; trivial to keep. 10. Low. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A05 App Intents and Siri Shortcuts
- **Original (both):** Intents: Open Scripture, Search Berean, Open Daily Note, Read Aloud, Open Workspace (and more past line 80, not read); each opens a deep link with `openAppWhenRun`.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/App/BereanIntents.swift` (103 lines), `src/lib/deepLinks.ts`. 3. intents → URL → router. 4. AppIntents iOS 17. 5. deep-link grammar (13 routes). 6. iPhone only. 7. An `AppShortcutsProvider` exists at `BereanIntents.swift:95` (corrected after doc 08 review). 8. `deepLinks.test.ts`. 9. Native
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A06 Deep links and URL schemes
- **Original (both):** `berean://` (dev: `berean-dev://`) routes: verse, open, note, lexicon, video, pdf (legacy `berean-pdf://`), search, trail, daily, share, workspace, session, chat[/new], `&play=1`; Mac registers via `setAsDefaultProtocolClient` and second-instance argv; iPhone `appUrlOpen` with dedupe.
- **Mac vs iPhone (original):** —
- **Original files:** `src/lib/{deepLinks,deepLinkTarget}.ts`, `electron/main.ts` (line 1370), `src/platform/ios/deepLinks.ts`. 3. one router. 4. none. 5. grammar. 6. Universal Links not implemented. 7. none. 8. `deepLinks.test.ts`, `deepLinkDedupe.test.ts`. 9. SW-DATA router + `onOpenURL`. 10. Links already written into
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — router handles verse, note, lexicon, video, pdf, search, trail, daily, workspace, session, chat; share not supported (no Share Extension). Production `berean://` registration waits for the release identity decision.
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A07 Widget
- **Original (both):** Static "New Message" widget (Home/Lock Screen) opening `<scheme>://chat/new`; no data in timeline.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/BereanWidget/BereanChatWidget.swift`. 3–6 trivial. 7. none. 8. none. 9. already SwiftUI. 10. Low. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** — / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A08 File providers / document access
- **Original (both):** No File Provider extension. Mac MAS: security-scoped bookmarks for vault and sync folder (`sandbox-bookmarks.json`, max 32); iPhone: iCloud container is document-scope public (`NSUbiquitousContainerIsDocumentScopePublic`, folder levels any) so the folder appears in Files; document picker for PDF/md import; `@capacitor/filesystem`.
- **Mac vs iPhone (original):** —
- **Original files:** `electron/mac/folderAccess.ts`, `ios/App/App/Info.plist`, `src/platform/ios/bridgeExtras.ts`. 3. system APIs. 4. n/a. 5. bookmark map. 6. Mac sandbox only. 7. DMG build unsandboxed. 8. none found for folderAccess. 9. Native security-scoped bookmarks. 10. Medium. 11. C-DATA.
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Open/save panels, document picker
- **Native files:** NoteFileTransfer.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A09 Notifications
- **Original (both):** No local or remote notification code (grep for `UNUserNotification`/`Notification(` finds none). 2. n/a. 7. VERIFIED by grep. 9. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Deferred
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A10 App lifecycle
- **Original (both):** Mac: single instance with second-instance handling, will-quit export, autoUpdater (beta channel, manual or auto download), power events (`powerAwareness.ts`), nativeTheme push. iPhone: AppDelegate/SceneDelegate, Capacitor lifecycle, background audio, pagehide flush, `BereanPowerPlugin` (low power).
- **Mac vs iPhone (original):** —
- **Original files:** `electron/{main,powerAwareness}.ts`, `ios/App/App/*.swift`, `BereanPowerPlugin.swift`. 3. native events → renderer. 4. electron-updater. 5. n/a. 6. MAS uses Mac App Store updates, DMG uses electron-updater (`app:isMasBuild`). 7. none. 8. `entitlements.test.ts`, `packagedAssets.test.ts`, `scripts/smo
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Single-instance lock, autosave on quit
- **Native files:** AppModel.swift
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A11 Entitlements, sandbox, identity
- **Original (both):** Two identities (Berean `com.berean.app`, Berean Dev `com.berean.app.dev`) with separate containers, groups, URL schemes; MAS sandbox entitlements (JIT, unsigned exec memory, network.client, user-selected rw, bookmarks, iCloud); Developer ID hardened-runtime entitlements (JIT, unsigned memory, DYLD); verify scripts check signed artefacts.
- **Mac vs iPhone (original):** —
- **Original files:** `config/app-identity.json`, `build/entitlements.*.plist`, `scripts/mac/{verify-mas,package-mas,build-mas-dev,profileAuthorises}.mjs`, `scripts/ios/{identity,verify-identity,dev-safety-check}`, `electron/appIdentity.ts`, `src/platform/appIdentity.ts`, `ios/App/*.xcconfig`. 3. generated xcconfig per i
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — Native dev identities isolated; device deploy guards
- **Native files:** scripts/native/ios-device.sh
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A12 App Store requirements
- **Original (both):** iPhone privacy manifest present (`PrivacyInfo.xcprivacy` declares UserDefaults, file timestamp, disk space, boot time), `ITSAppUsesNonExemptEncryption=false`, location/photos usage strings, ATS local networking exception; Mac `privacy.md/html` docs; `audit-production.mjs` checks shipped content.
- **Mac vs iPhone (original):** —
- **Original files:** `ios/App/App/{Info.plist,PrivacyInfo.xcprivacy}`, `docs/{privacy.md,privacy.html,mac-app-store.md}`, `scripts/audit-production.mjs`. 3–6 n/a. 7. App Review exposure from YouTube scraping/BibleGateway credential flow (INFERRED); privacy manifest for third-party SDKs (onnxruntime) not audited. 8. `ios
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — Release gate (not in scope)
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A13 Share/print/export to Files (iPhone)
- **Original (both):** `@capacitor/share` for text/markdown, `BereanPrintPlugin` for print/PDF. See N09. Status: implemented. 2–11 as N09 (iPhone side).
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Note share/export; no verse share sheet
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A14 Accessibility
- **Original (both):** `BereanA11yPlugin.swift` (64 lines), `aria-label` usage in React; SPEC scenario 30 notes no VoiceOver pass. 2. `src/mobile/*`, plugin. 7. No VoiceOver audit (SPEC, BLOCKED device). 8. none. 9. Native a11y comes mostly free. 10. Web a11y gaps do not carry over. 11. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Labels/hints on new controls; no full VoiceOver pass
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### A15 Auto-update and distribution (Mac)
- **Original (both):** `electron-updater` with GitHub Releases, stable/beta channel, GitHub Actions release workflow, DMG notarisation via `build/notarize.js`; MAS path separate. 2. `electron/main.ts`, `scripts/tag-release.js`, `.github` (not in this checkout listing). 7. Release CI not inspected. 8. none. 9. Sparkle or App Store only. 10. Update channel continuity for existing DMG users. 11. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / — — Release gate
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O01 Deep-linked "Berean Dev" identity separation
- **Original (both):** 
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ✅ / ✅ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O02 Crash report on next launch
- **Original (both):** 
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** ❌ / ❌ — not started
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O03 Hermas / Recognitions special-case handling
- **Original (both):** Hermas has two translations and a traditional numbering map (`hermasMap.ts`); Recognitions and Hermas rows are paragraph-sized "verses"; Taylor footnotes cross-refs; section titles. Files `src/lib/{hermasMap,prologueBooks,chapterNumbering}.ts`, `setHermasTextId` global in `parseRef.ts` (module-level mutable state, VERIFIED). 7. Global mutable setter is a hidden coupling. 8. `hermasMap.test.ts`, `hermasTaylor.test.ts`. 9. SW-DATA. 11. C-DATA.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** 🟡 / 🟡 — Hermas sections/Recognitions numbering in parser; Hermas translation choice not exposed
- **Native files:** —
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O04 Data publication pipeline
- **Original (both):** `scripts/publish-data.js` uploads `data/*.db` to a GitHub release for CI; `audit-production.mjs` guards packaged content. Native build must replace with an asset pipeline. Status: implemented, tooling only.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — Pipeline unaffected
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

### O05 Diagnostics and performance tooling
- **Original (both):** `src/lib/{perfMarks,perfSpan}.ts`, `scripts/perf/*`, `docs/performance-audit-2026-10-19.md`, `electron/devTools.ts` (dev-only guards), `src/platform/ios/{devProbe,perf,selfTest}.ts` (BEREAN_E2E_PROBE builds). 7. The probe must be absent from release (`npm run audit:prod`). 8. `devTools.test.ts`. 9. Instruments/`os_signpost`. 11. n/a.
- **Mac vs iPhone (original):** —
- **Original files:** —
- **Known original defects:** —
- **Native Mac / iPhone:** — / — — not started
- **Native files:** 
- **Acceptance:** the original workflow above completes natively on each applicable platform, exercised in the running app; data contracts unchanged (golden where a service exists).

---

## 2026-11-14 evening parity updates (Claude Code)

Statuses below supersede the per-feature rows above where they conflict; evidence is in AUDIT-2026-11-14.md (section C/D rows) and
HANDOFF.md "2026-11-14 evening checkpoint".

| Area | Now native | Verified |
|---|---|---|
| Lexicon search / browse (D1) | Lexicon tab search view (All/Hebrew/Greek), palette "Search Lexicon", accent-free transliteration matching, reader "Look Up in Lexicon" | Mac live; iPhone simulator |
| Lexicon entry (D2, D3, D17, D18, D19) | Strong's links in gloss/definition/derivation, Strong's context menu on Derived Terms, BDB Notes with expanded abbreviations, word replacer on lexicon prose, H853 explanation, Show All / Show Fewer occurrences, ‹ › + Search in the toolbar | Mac live (D19 build only) |
| Psalm superscriptions (D5) | Title line above the first body verse for KJV/KJVA/Brenton (generated tables) | Mac live; iPhone simulator |
| Annotation hide toggles (D6) | LXX / Enoch / Jubilees via the tab's `hiddenAnnotations` | Mac live |
| Search (D7, D8, D9) | Search for selection (reader menu), ±1/±2 verse context, single-verse query → cross references | Mac live |
| Palette (D22, D23) | Next/Previous Chapter, Show/Hide Strong's, typed-command ranking, Shift-Return = new tab | Mac live |
| Daily notes | Long date titles with "Sabbath"; Notes Home Today's Note button | Mac live |
| iPhone reader (I5, I14) | Hide-on-scroll capsule + dock; edge taps turn the chapter | iPhone simulator |
| Workspaces (I21) | Icon picker (original Lucide names in `sessions.icon`) | Mac live; iPhone build |
| Settings (I12) | iPhone Haptic Feedback toggle (`berean.haptics.enabled`) | build |
| Mac pointer | Hand cursor on every native control | Mac live (`screencapture -C`) |

### 2026-11-17 cursor and Notes navigation evidence

Mac Settings Verse Numbers native switch reported settled hand/hand after dragging within it; preference was restored to on. Native switch hooks and SwiftUI enabled-state refresh are implemented. The stationary enabled-state path remains unverified. iPhone Notes home uses grouped scroll targets; opening lower recent notes and returning visibly restored the recent area with the final row clear of the dock. Idle touch-scroll retention and missing-recent fallback still need direct QA. Both Dev builds pass. N06 summary corrected from source evidence: both editors already call NoteVerseRefs.linkSpans when detection is enabled. N11 summary now matches its partial detailed status because Board remains open.

### 2026-11-17 N06 completion evidence

Native note-title completion after [[ is implemented on both platforms. Mac keyboard/pointer choice and Escape/query editing passed; iPhone touch insertion and separate Undo/Redo passed. Exact stored Markdown was verified in both QA libraries. Source helper covers UTF-16, code/escaped/closed triggers and stale selection. Mac following-typing undo coalescing remains open, along with Scripture/book autocomplete and broader accessibility/scroll/IME checks. N06 stays partial.

### 2026-11-17 query/undo verification update

Mac note completion Undo/Redo now separates following typing in the directly tested path. Notes query history and Lexicon query replacement/history passed live Mac checks; Lexicon query/language survived Simulator relaunch using legacy state keys. Calendar/History/Tags current-tab replacement and backward traversal passed. All 156 optimized package tests in 46 suites passed on simulator SQLite; app builds also pass. These scoped checks do not complete N06 book/Scripture autocomplete or the broader parity gates.

### 2026-11-18 incremental evidence — S08/S13
S13: actual mapped chapter availability now governs translation choices; unavailable saved columns retain repair controls, independent valid passage selection, disabled invalid FollowMain and filtered OpenInReader. Mac repair/close-last/Back/Forward checked, explicit gutter alignment and removed repeated per-verse menu chrome. iPhone compact/drag coverage remains open.
S08: shared native background renderer restricts text selection/highlight fills to readable words per wrapped line. Mac live partial Mark13 selection/highlight and offscreen gutter/Strong’s/tag regression pass. iPhone word selection and tap multi-select checked, extended native handles and physical phone pending.

### 2026-11-18 incremental evidence — Notes/calendar
Daily-folder date discovery now includes a month grid with existing-note dots, month navigation, Today and date picker jump. Mac and iPhone existing-note reuse checked through the original daily identity path. Mac Checklist/Table are direct toolbar controls, native menu shortcuts retained. Formatting Undo/Redo is independent of preceding/following typing. iPhone fixed large Notes/folder heading verified after return; collapsing-title behavior is not implemented. Full native Kokoro engine remainsTODO.

### 2026-11-18 incremental evidence — M05 groundwork
Kokoro neural latency chunking and UTF16 verse/word alignment metadata now have native service parity against48TypeScript oracle cases.177sharedRelease tests and both app builds pass. Speech preparation, model/voice/cache integration, synthesis, streaming playback and native controls remain unfinished; M05 audio parity is not achieved.

### 2026-11-18 incremental evidence — M05 preparation
Spoken-only numeral/abbreviation/pronunciation/punctuation and tagged/plain replacement/UTF16 word-slot alignment now native, checked against original generated fixtures. Original plain speech-text/offset inconsistency fixed.179sharedtests,104originalTTS tests and both native builds pass. Native ONNX/phonemization/asset/audio integration and listening/device acceptance remain open; ReadAloud playback parity is not claimed.

### 2026-11-18 — Native Scripture viewport persistence
Implemented local bounded chapter/edition position persistence, including end/verse-relative/selection geometry; original allowlists agree. Actual MacQA and iPhone27 simulator deep relaunch restoration verified. Full cross-tab-type/history/edition/resize/device matrix remains partial. ReadAloud inference/playback remains unfinished.


M05 partial18Nov: reproducible native phonemizer now matches original raw US/British IPA for32cases on each platform. Kokoro normalization/tokenizer, synthesis/playback/cancellation and listening still open; no app dependency added.

18Nov note discovery regression resolved for tested Mac/iPhone paths: exact-title current-query results, rapid replacement and opening. Original FTS semantics retained. Other query/IME/metadata matrices remain partial.


18Nov Notes titles wrap on both native platforms and preserve Return-to-body workflow and original single-line metadata; runtime checked on Mac and iPhone27 simulator. Broader accessibility/keyboard/Undo acceptance remains.


18Nov M05 partial: original Kokoro English normalization and phonemes verified on both platforms (104comparisons each),184sharedtests and both builds pass. Backend dependency/resources remain probe-only; synthesis/playback/settings/cancel/word timing and quality/device/licensing gates unfinished. Owner reports chapter spinner/stutter/short-page gesture gaps; track as open.

### 2026-11-18 — Reader gesture checkpoint
iPhone short-page pulls now use passive raw touch travel; deliberate chapter turns have explicit start/end arrival. Mac scroll checkpoints reuse one idle timer; short pages allow elasticity. Both builds and intent checks pass; simulator boundary cycle and Mac checkpoint/relaunch verified. Loading flash and physical gesture feel remain open. See HANDOFF latest checkpoint for evidence and continuation.

### 2026-11-18 — Prepared chapter-turn checkpoint
Added16chapter read-only preparation cache, shared in-flight loads, actual-neighbor prefetch, outgoing viewport capture and atomic destination rows/annotations/selection for explicit turns. Both native builds pass; Mac history/selection and iPhone short-page cycle checked. Removed iPhone empty system glass circle when chrome tucks. Other navigation paths can still show loading; global frame pacing remains open. See latest HANDOFF for scope, exact evidence and queued CI status.

### 2026-11-18 — Direct warm Scripture presentation
Cached chapters and revision-scoped annotations now render directly for warm navigation; location-scoped selection/scroll targets prevent stale state. Native view reuse captures outgoing viewport;16entry cache protects visible chapter and coalesced waiters publish before returning. Both final native builds pass; Mac34step boundary/history test, local selection/highlight refresh, phone mapped Psalm return and tab restoration checked. Cold misses/frame pacing remain open. Prior-head CI cancelled before runner assignment due hosted macOS capacity; see HANDOFF for exact evidence and next work.

### 2026-11-18 — Working tabs first on iPhone
Tab overview now opens expanded and shows current tabs before creation/cleanup/archive controls and recent duplicates. Existing actions and optional compact detent remain. Simulator existing119→G5463→119 navigation preserves viewport; nine tabs unchanged. Final iOS build passes. See HANDOFF for exact evidence, remaining large-workspace/accessibility checks and hosted CI capacity cancellation.

### 2026-11-18 — Passage preview prepares the reader
Shared previews now reuse a bounded prepared chapter with separately retained raw rows, warming both Mac palette/CmdL and iPhoneGo destinations without changing excerpts or navigation semantics. Both builds and raw LXXPsalm 3 heading→bodyverse2 UI checks pass; current-tab reuse leaves13MacQA/9phone tabs unchanged. Fast submit before preview is ready can still be cold. See HANDOFF for oracle/evidence and remaining selection/performance work.


### 2026-11-18 — Reader selection gesture checkpoint
iPhone Scripture selection: targeted final-source simulator verification of rapid adjacent body2–4 selection/actions, number2+3 selection and single-toggle, native double-tap/longpress with exclusive native handles/menu, Strong's link and ordinary scroll. Clean Mac+iOS builds pass. Does not close hardware, VoiceOver, accessibility timing, every native selection action or frame-pacing parity.


### 2026-11-18 — Reader release and sidebar restoration
Reader responsiveness: independent annotation groups reuse unchanged query results; Mac live note/tag/highlight add/remove checked. iPhone short-page chapter pulls now retain intended START/END arrivals after native release, verified in a clean build. Mac sidebar navigation restored and tested through hide/show and history/selection roundtrip. Pin trailing rest position checked; physical hover, accessibility timing, frame pacing and cold-submit parity remain open.

### 2026-11-18 reader presentation clarification
Brenton Psalm title + first body now target a single displayed verse1, consistent with Bible Hub/BiblIndex body-first presentation; raw edition IDs remain unchanged for legacy notes/highlights/links. Current final verification pending (HANDOFF). LXX badge hover follows pin pattern. Full generic split/tab composition and Compare per-edition selection are still gaps, not completed parity.

Latest verification: full Swift suite192tests/55suites PASS; focused Psalm suite8 PASS; slow-pull harness PASS. Both final ancillary-label builds PASS (/tmp/berean-psalm-label-consistency-{mac,ios}.log). Mac/simulator reader UI checks described in HANDOFF. Scope is body-first Brenton presentation with unchanged storage IDs, plus LXXbadge/native-menu/pull refinements; generic splits/cursor replacement and notes-generated reference-link semantics audit remain open.


## 2026-11-18 — location input, native cursor ownership and iPhone verse taps

- Mac ⌘L now owns keyboard focus before its field mounts, preserves early keys/paste, selects the current destination once, and replaces the current tab across Scripture, Search, Lexicon and Notes. QA verified the original tab identity, 13-tab count and unchanged note content/update time. Explicit Shift-Return creates a tab; closing it currently selects its neighbor, not necessarily its origin.
- Removed global cursor swizzles/private toolbar hooks and forced hands. Native controls, text, links and dividers own their cursors. Source audit and builds passed; physical pointer-motion/flicker coverage remains open.
- iPhone body taps use a passive touch observer: rapid verse1/2/5 accumulation, targeted deselection, native word double-tap, 400ms taps, 900ms long-press, scroll cancellation, chapter pull and inline Strong’s were exercised in the Simulator. The new pure reader-taps harness joins CI. Physical iPhone/VoiceOver and handle dragging remain unverified.
- Added a 44pt accessible Close Study Panel control; final fresh-launch Simulator check dismissed the G2962 inspector. Restored Psalm 3 LXX, Strong’s OFF, no verse selection, 9 tabs. Both final local builds PASS: `/tmp/berean-study-close-final-mac.log` and `/tmp/berean-study-close-final-ios.log`.
- Online rendering verified again: [Brenton Psalm 3](https://biblehub.com/sep/psalms/3.htm) combines the title and first body line as verse1. [Brenton Psalm51 / LXX50](https://biblehub.com/sep/psalms/51.htm) does the same for its longer title. Preserve Septuagint chapter numbering and raw stored IDs; display/copy/accessibility numbering follows the reader. Do not reinterpret persisted links or rewrite production data.
- Next: per-edition Compare selection and whole-block dragging; generic all-tab split previews; physical cursor motion and Mac scroll/pull feel; note reference formatting/preferences; M05 Kokoro playback. These remain unfinished. Owner-only merge order #22 → #23 → draft #24 remains unchanged.


## 2026-11-18 — corpus-wide Brenton rendering and combined verse compatibility

The actual 151-Psalm corpus check found that stored LXX 115:4 contains both the cup and vows sentences, with no stored verse 5. The reader now labels that record 4–5, preserves all its words/annotation identity, resolves human-entered verse 5 to stored4, and maps KJV 116:14 to that existing record in Compare/flip. Verse6 and following keep their numbers. Labels, selected references, chapter export, partial copy and accessibility use the range. Raw persisted links, tag spans and note/highlight keys are not rewritten.

Online witnesses: [Bible Hub Psalm 3](https://biblehub.com/sep/psalms/3.htm) and [MT51/LXX50](https://biblehub.com/sep/psalms/51.htm) combine superscription and first body as verse1. [eBible Brenton115](https://ebible.org/eng-Brenton/PSA115.htm) calls the second sentence4a; [Bible Hub MT116](https://biblehub.com/sep/psalms/116.htm) separates the two sentences at13–14. Reader 4–5 is the numeric presentation of that combined record, consistent with the chosen body-first convention, rather than a claim that every online edition uses identical labels. Keep actual LXX chapter numbering; do not substitute a site's MT chapter headings.

Verification: all 195 shared tests/57 suites PASS in139.323 s from a temporary native-build source snapshot; all 120 package source/test/fixture SHA256 values were checked against the repository with zero mismatches. Log `/tmp/berean-online-brenton-final-suite.log`; manifest `/tmp/berean-online-psalter-source/source-sha256.json`. Initial corpus test correctly failed on115's gap and motivated the range fix. Direct checkout test attempts were interrupted only after diagnosing cloud-backed Git/build database waits; no caches or usage were reset.

First range builds BOTH PASS: `/tmp/berean-brenton-range-final-{mac,ios}.log`. Fresh iPhone PID32126 verified Go 115:5→115:4–5, readable gutter label, both sentences selected, verse 6 unchanged and9 tabs. Selecting6 then exposed separate outlines at the missing stored5. Final source fixes drawing/reveal grouping by actual row order while still breaking at unselected rows or real rows without layout; persistence stays unchanged. Reader tap + adjacency harness PASS with immutable inputs `/tmp/berean-final-range-selection-checks` (explicit temporary module-cache path after a sandbox cache-write failure). Final grouping builds and Mac/iPhone UI checks subsequently PASS; see verified publication checkpoint below. Reference labels also coalesce adjacent displayed ranges without changing saved raw groups.

The single4–6 outline, copy/reference labels and fixture restoration are now verified on both apps. Publish only the tested source and its checkpoint. Audit combined-record cross-reference aggregation and newly generated Markdown/link display vs raw IDs; original legacy links must keep their meaning. Generic all-tab split previews, per-edition Compare selection/whole-block drag, physical pointer/flicker, Mac scroll/pull feel and M05 playback remain open.


### Verified publication checkpoint — source `8492a161`

Both final grouping builds PASS (`/tmp/berean-brenton-group-final-mac.log`, `/tmp/berean-brenton-group-final-ios.log`). iPhone fresh PID33697 showed one outline around 4–5 + 6, correct targeted deselect/reselect and native Copy→Paste containing `Psalms 115:4-6 LXX`, range label4–5 and verse 6, without extra text/rows. Restored Psalm 3 LXX, no selection, Strong’s OFF, inspector closed,9 tabs. Mac fresh QA launch verified ⌘L115:5→115:4–5, Shift-click 6→one4–6 outline, Copy Reference→immediate ⌘L paste exactly `Psalms 115:4-6 LXX`, then restored Psalm 50:1 LXX (raw 3),13 tabs. Readonly DB confirms original tabID0456641d-da15-49d2-8620-cdf2b9d1f0bd/typeBible retained and GalleryQA07 content SHA256 AND updated_at unchanged.

Full 195 shared tests/57 suites passed; after adding corpus-version coherence assertions, the 3 focused tests passed again (`/tmp/berean-brenton-corpus-coherence-final.log`). All120 package snapshot hashes matched repo. Tap + visual-adjacency harness passed. No application code changed after final builds/UI checks. Physical iPhone/VoiceOver, physical cursor-motion/flicker, full Mac scrolling performance and combined-record cross-reference aggregation remain open.

Commits: faf8589d location focus/input;3c38eb5c native cursor ownership;819f9954 iPhone body taps/CI;59bbd436 accessible inspector close;8492a161 combined Brenton records/visual adjacency. The next docs commit records this checkpoint. Publish the complete checkpoint to **github**/native/reader-notes, existing draft24; compare remote head with local HEAD and read CI for that exact PR head. Prior74aeb6c5/CI44391471644 is historical evidence only. PR22/23/24 were rechecked OPEN,24draft/base native/m6-navigation; owner-only merge order unchanged. Do not merge or inherit old green checks.


## 2026-11-19 — Scripture presentation parity increment

Source739c5e41: native Mac/iPhone superscription + first body share a numbered verse group, iPhone title/body tapping selects it, adjacent group outlines and native word selection verified. Edition numbering differences are quiet metadata with on-demand explanations. See ONLINE-BRENTON.md for independent witnesses,4–5 normalization and edition boundary caveats. Both app builds and197 shared tests pass; font/accessibility variants remain open. This is not full Compare parity: per-column selection and lifted dragging remain undone. Cross-reference canonical source identity is still a confirmed correctness gap despite improved display metadata.


## 2026-11-19 — native references, toolbar responsiveness and Strong’s continuity

- 42d34bbe: additive native cross-reference APIs map verified stored LXX rows to canonical sources; correct chapter grouping and combined-record aggregation. Legacy service entry points/goldens remain intact. Classic/TSKe selected and chapter UI checked on both apps; structural unverified alignments remain open.
- fce2b88e: native navigation ControlGroup replaces fixed-size HStack; measured Mac toolbar CPU loop resolved while retaining sidebar titlebar placement. Baseline99.5% CPU/AX20–40s → idle0–3.3%/AX0.1–0.4s. This supersedes prior automation-latency diagnosis; broader physical interaction checks remain.
- 3bbecdea: native readers retain the visible body line when Strong’s toggles, preferring a visible selected verse and excluding inline metadata from anchor offsets. Mac selected/unselected and iPhone mid-chapter on/off verified; physical phone and full edge/width matrix pending.
- Validation: full202 shared tests; final6 focused cross-reference checks include all151 Psalms source bounds. Fresh reader intent/reflow harness passes Unicode/metadata mapping and prior tap/adjacency checks. Both final native builds pass. See current HANDOFF for exact logs, QA restoration and remaining tasks; source corpus/production/sync/identities unchanged.


## 2026-11-19 — Compare selection and floating actions (d6f7cced)

Each edition now owns its selectable verse numbers and action target. Additive taps/Mac Shift use actual stored row order; selection itself does not change the anchor passage or history. Adjacent visible selected rows share one faint/dashed outline; stacked interleaved editions remain outside each other’s outlines. Reduced Motion pauses animation. The adaptive glass action bar reuses reader control styling and supports copy/highlight/tag/note/reference/reader/share/clear operations. iPhone dock safe-area clearance was verified after an initial hidden-bar failure. Mac Command-C was verified after fixing a focus-routing failure. Clearing and exiting Compare does not restore an old selection. Shared title rendering uses the Scripture font and folds source title newlines.

Both local Dev builds and the expanded native reader harness pass. Mac LXX50/KJV51 copy and action destinations, Mac Shift group/Escape, and iPhone stacked selection/copy feedback/reader transfer/final dock gap/clear-exit passed. See HANDOFF for exact logs and QA restoration. No note contents/timestamps changed;4 Mac/9 iPhone tabs preserved. Prior baselinecce95bf0 CI44493859591 is green, including203 shared tests; this is not evidence for the new source’s pending CI.

Remaining before full Compare parity: view-state retention across tabs/relaunch, independent/pinned/cross-chapter/duplicate/4-column/width/accessibility matrix, actual mutation-and-undo action checks, native word-copy precedence, body-tap selection, selected-line reveal, and whole-block drag previews/grab-anywhere. Generic arbitrary-tab splitting and Kokoro playback remain separate open work.


## 2026-11-19 — Compare tab return and explicit location intent (3090db5c)

A bounded local snapshot per open tab now restores the selected Compare column/edition/chapter, selected stored rows, focus and original Shift anchor across tab switches. Close/explicit Compare arrival clear the cache. It is observation-ignored memory, with no new persisted/synced fields; restart retention remains open. Incoming explicit references override old local selection, including same-chapter and repeated identical commands. A fresh jump revision also restores the requested scroll position. Ordinary Go deduplication still uses the original one-argument isShown match, which excludes Compare.

Final Mac/iOS builds pass (`/tmp/berean-compare-intent-complete-{mac,ios}.log`), and expanded native harness passes retained-anchor and unavailable-row cases. Mac UI verified LXXGenesis12 → Notes → return retaining selection; new/repeated Go to KJVGenesis11 replaces it, and repeat Go moves from near-end offset back to verse11. iPhone verified KJVPsalm3v1 → existing G5463 → return retaining that edition/selection.4 Mac/9 iPhone tabs preserved; original QA passages restored and all7 Mac QA note contents/timestamps unchanged. Earlier repeated-command failure and intermediate method-reference compile errors were corrected, not counted as passes. Full independent/pinned/history/restart/4-column/accessibility coverage, native word-copy precedence and whole-block dragging remain open.


## 2026-11-19 — Compare passage lift follow-up (7d365304)

Native Mac drag sources now cover headers, verse-cell whitespace and independent panes, with a readable glass passage preview, faded source and destination wash. Reorder remaps edition selection/scroll caches without changing legacy column records. Aligned two-edition reorder in both directions, exact mid-chapter scroll retention, Escape cancellation and native word-copy precedence passed. Both local native builds pass. Preview is a reconstructed visible excerpt; system-owned ghost pixels and physical feel were not captured. Pinned independent attempts did not demonstrate a successful drop; keep that matrix,4-column/duplicate/narrow/accessibility and selection removal/action writes open. CUA requires a final destination click to complete the native drop in this environment; do not misdiagnose its pending session as a stuck app. See HANDOFF/CHANGELOG for exact evidence/restored QA and CI scope. Generic arbitrary-tab splitting remains planned only. Strong’s body-word reading continuity is delivered; long-verse/end/width/hardware checks remain.


## 2026-11-19 — Compare Strong’s continuity (f0b8752e)

Shared Compare scroll now follows a visible verse through Strong’s reflow, preferring visible selected focus; independent and stacked hosts also receive verse-based restoration. Deferred work yields to newer explicit navigation/current-tab/passage/Compare-mode changes. Main Reader retains the finer body-word position separately. Mac aligned UI verified verse8 retained on enabling and selected11 retained on disabling; final guarded Mac/iOS builds PASS. Guard race matrix, independent/stacked/iPhone runtime and full width/long-verse/hardware checks remain. Nested drag-source removal experiment did not establish a pinned-drop fix and was fully reverted; pinned native dragging remains open. See HANDOFF/CHANGELOG for exact logs, QA restoration and CI status.


## 2026-11-19 — Notes formatting and context-menu follow-up

347cf74a routes native inline formatting through a shared, source-preserving cell edit: confirmed table pipes/rules/padding remain intact; mixed cells toggle together; existing inline constructs keep their rendering/source rather than becoming malformed enclosing marks.9 focused regressions and all212 package tests pass. Mac whole-table bold/toggle/Undo/Redo and exact persisted source verified. Arbitrary nested marks and the separate colored multi-cell highlight adapter remain open.04079bdf shortens the iPhone preview and groups Share/Print/Export; simulator now shows the entire primary menu including Trash and its action worked. Both final native builds pass. iPhone grid rendering passed; iPhone formatting/Undo remains unverified because remote keyboard input changed text unexpectedly. All original7Mac/17iOS note contents/timestamps unchanged, synthetic notes in recoverable Trash, original passages restored/4Mac/9current-iPhone tabs. Read HANDOFF for logs, simulator container relocation, input failures and next gates; no production/sync/schema changes or merge.


## 2026-11-19 — Multi-cell/multiline note highlights (8adef50b)

Default/color/Remove Highlight now share one source-preserving edit across cells and paragraphs, including partial recolor/removal and mapped selection. Color application is idempotent; structural Markdown/line endings and existing code/links/other marks survive. Other marks remain protected rather than gaining nested styling. Escape atoms stay together even under partial selection (initial failed readable-text case corrected).20 focused tests and all223 package tests pass; both native builds pass. Mac actual6-run Blue→Undo/Redo→Green→Remove restored the exact original source and grid; synthetic note in recoverable Trash, original7 note hashes/timestamps and4workspace tabs unchanged. iPhone8ade runtime and full native partial/nested/width/hardware matrix remain open. See HANDOFF for exact logs, evidence limits and pending exact-head CI.


## 2026-11-19 — Combined note rendering (09eb7d84 /6555fd0e)

Existing strong/emphasis combinations now use Foundation source positions while custom marks/raw IDs remain source-preserving. Literal code and link destinations stay intact; the native punctuation-only mark fallback remains. Bounded thread-safe process cache avoids reparsing unchanged bodies; synthetic parser timing matches the old path after caching (not a whole-editor latency claim). Highlight backgrounds now exclude hidden glyphs; real Mac empty blue strip disappeared.9new tests,46focused and all232package tests pass; both final native builds pass. Mac combined styles/table, plain copy and Command-B round trip verified with exact source retained; synthetic note trashed, original7 note hashes/timestamps and4workspace tabs unchanged. Whole protected highlight runs can be cleared; unsupported partial nested edits remain unchanged and full rich-mark mutation parity remains open. iPhone runtime/physical/accessibility/large-note matrix and GFM escaped wiki-alias identity verification remain queued. See HANDOFF for exact logs and CI scope.

## 2026-11-19 — iPhone formatting target survives Undo/Redo

All iPhone programmatic note formatting uses the existing literal-source undo path with validated text/selection bounds. This fixes Redo collapsing selection and a subsequent format button inserting empty marks at the caret. Real simulator touch Bold→Undo→Redo→Bold and Highlight→Undo→Redo→Highlight restore the exact whole original table fixture; selected Prayer retains visible handles. iOS build passes (`/tmp/berean-note-selection-undo-ios.log`). Original17 notes unchanged,47active tabs retained, synthetic notes recoverably trashed. Mac/package unchanged; previous232tests/Mac build are baseline, not fresh checks. Broader multi-cell/combined-style/color/typing/IME/accessibility parity remains open. See HANDOFF for IDs and clipboard method.

## 2026-11-19 — Combined formatting of visible note text

Shared native formatting now adds styles to existing styled text and toggles exact marked runs independently, including bold+italic shared boundaries. It verifies plain text and prior style coverage before accepting the source edit. Mac and iPhone actual UI passed a selected table word through Bold→Italic, independent Bold removal, Undo and independent Italic removal; exact saved source confirmed.236tests and both SDK27.2 builds pass (HANDOFF has logs). Partial removal inside a larger mark, whole-table combined editing and broader rich-editor parity remain open. Table wiki-link normalization is deferred because actual legacy serialization proves an identity collision; see NOTE-TABLE-LINK-COMPATIBILITY.md.

## 2026-11-19 — Remove note styles from part of a passage

Native Notes now removes a style only from selected visible text while retaining surrounding formatting, including nested emphasis. Global visible-character/semantic validation protects neighbouring styles and link/code identities. Mac and iPhone live checks passed sequential Bold/Italic removal from Bravo inside a formatted table phrase, plus exact Undo/Redo and selection retention.240tests and both final SDK27.2 builds pass; HANDOFF contains logs, initial failures and cleanup evidence. Whole-cell/table mixed hidden-syntax edits and broader rich-editor parity remain open.

## 2026-11-19 — Generic tab-split model groundwork

Added process-local pane-tree edits/geometry, atomic layout undo and scoped/versioned tab-drag payload validation.8focused tests include484ordered tab-family/edge cases. Full248tests and both SDK27.2 builds pass (`/tmp/berean-pane-layout-*` logs). No split UI, drag target/type, app command routing or persistence is enabled; TAB-SPLIT-DESIGN.md specifies the next extraction and remaining gates. Separately, actual Mac Compare independent KJV10/LXX5 reading positions survived Strong’sON/OFF; exact intra-row position and broader matrices remain open. Original notes unchanged; HANDOFF has precise evidence.

## 2026-11-19 — Explicit Mac tab content host

MacRootView now delegates its current single document to MacTabContentHost(tabID:), preserving identity/toolbar/inspector behavior and handling a stale tab explicitly. Mac build and real Scripture/Notes/Calendar/History/Tags/Lexicon/Search checks pass; exact37original tabs and7original notes preserved. Shared248tests/iOS model-build baseline unchanged. Background-pane command/focus/toolbar/editor coordination and actual drag previews/splits remain unfinished; see TAB-SPLIT-DESIGN/HANDOFF.

## 2026-11-19 — Pane selection and compact command-scope model

Added focused-document replacement, visible-tab reuse, scoped/stale command-target checks and compact focused projection retaining the full split tree.13focused model tests pass (including484family/edge cases); full253tests and both SDK27.2 builds pass (`/tmp/berean-pane-focus-*` logs). Minimums now key on TAB ID so replacements use their own document constraints. AppModel command routing, pane environment, compact picker and visible splits remain unimplemented; this is model groundwork only. HANDOFF/TAB-SPLIT-DESIGN record the exact next bridge and validation.

## 2026-11-19 — Reader annotation workflow

Intentional visual departure from Electron: tags/note counts moved outside running Scripture into contextual study details. Tag search/add/member-removal implementations remain accessible there, and Compare opens the exact edition’s notes. Built-in Cross Refs unchanged; personal citation ↗ marker still needs calm unified treatment. Rendered acceptance and unverified cases in READER-ANNOTATION-DESIGN.md; no native-feature-complete claim.

## 2026-11-19 — Personal references and follow-up queue

Native My Notes parity gains ordinary-note per-verse indicator index without altering the legacy indirect list/parser; preserves outgoing linked passages and range/chapter scope through contextual study route. Full auto verse/Strong’s settings/tracking audit still required by latest steering. All254tests/both builds pass; see reference-design evidence and FOLLOWUP-2026-11-19.md.

## 2026-11-19 — Automation QA isolation

Debug-only named QA library/preferences now implemented; regular behavior/identities unchanged. Live named-suite writes and parser safety checked; full255tests/both builds pass. Use only the separate app path/profile in QA-PROFILES.md; preserve concurrent shared-QA user edits. Notes controls/viewport follow-up is validated in the worktree.

## 2026-11-19 — Study controls and viewport lifecycle

Notes scope/sort functionality preserved in simpler inline search menu; Notes-first display and personal annotations retained. Verified native saved-position lifecycle fix, independent of persistence format. Remaining automatic verse/Strong’s tracking/settings, Markdown/table/share/history, RTL and substring/lexicon highlight parity stays OPEN. Full255tests/both builds pass; rendered feature parity is limited to the named UI checks.

### 2026-11-19 Notes preview/table follow-up

Study-note rows now use semantic readable previews (iPhone wiki-bracket regression verified). Both editors publish retained-selection table context; Table menu adapts between insertion and row/column/delete operations. Mac contextual insertion, original-source undo and prose reset verified; iPhone context interactions/full Markdown edge cases remain open. Both builds pass. See HANDOFF dated entry for logs, disposable fixture cleanup and unchanged original note/tab/tag invariants. Remaining share/version/RTL/match/auto-reference audits are not marked complete.

### 2026-11-19 sharing, BDB and navigation increment

Mac Notes sharing now uses a stable native toolbar anchor (repeated open/cancel verified); ordinary editor/list/bulk note sharing uses readable text, explicit Markdown copy/export retained. Version history spacing/preview polished (Mac preview verified). Native BDB selectable prose uses an explicit English paragraph base; Mac mixed Hebrew/English logical copy and iPhone word handles verified. Search substring marks and Lexicon bold+faint match backgrounds verified. Found/fixed iPhone New Tab sheet intent loss: explicit H1 created a separate tab, ordinary Go reused G5463; cleanup restored exact47IDs. Final builds pass; detailed limits/paths in HANDOFF and SHARING-AUDIT.md. New Compare→Reader viewport shift is OPEN; no all-scroll/no-Markdown/all-share/all-parity completion claim.

### 2026-11-19 reader layout and reference tracking

8f680362 fixes repeated Compare→Reader width-reflow shifts by retaining the immediate restoration intent through initial layout changes, yielding to input. Final no-trace UI roundtrips retain0.5418427726120034; physical smoothness/full races still open.03697661 restores original Strong’s detection preference on both apps; Mac explicit-link independence and iPhone OFF persistence/ON restoration verified. c8fbfe2e removes canonical-name/80-result loss of ordinary-note citations; real Jn3:17 MyNotes UI and90+note/edit/Trash/restore tests pass. Full256tests/both builds pass, original13/17notes/38/47IDs/tags unchanged. HANDOFF and NOTES-REFERENCE-PARITY.md provide precise remaining matrices; broader goal remains active.

## 2026-11-19 — Personal lexicon Notes and simpler iPhone commands

Implemented shared Lexicon My Notes backlinks using normalized bare IDs and actual lexicon destinations, preserving note-title wiki identities and excluding code/images/comments/unrelated URLs. Ephemeral off-main, revision-aware index has no result cap or schema change. Mac normalized/explicit-link/edit invalidation and iPhone existing-note/open/top-Back return verified. iPhone More now groups reading/chapter/tab/study commands with Settings directly reachable; tab previews use readable excerpts. Full 258 tests and both return-fix builds passed; final disclosure polish build logs and full evidence/limits are in HANDOFF. Physical scroll/hover, compact/history/performance/reference grammar, rich tables/all sharing/live panes/Kokoro remain open. Production data/identities untouched; review guard and active goal unchanged.

## 2026-11-19 — Search/study/Compare/window follow-through

Seven focused source commits now deliver the Mac chapter share anchor (actual open/cancel twice), aligned inline search controls and grouped Options (Exact phrase/reset checked), grouped Notes inspector with compact desktop chapter scope, searchable Shortcuts (action/modifier/no-results/clear checked), iPhone Compare body selection (LXX/KJVA/number-clear checked), persistent window inspector with settled native width retention and explicit sidebar240/panel320/window1000 minimums, and local cursor-region yielding at native dividers. Both apps build; latest Mac-only limits/cursor builds pass. Physical cursor/drag/first constrained Compare reflow/all-tab history/toolbar matrices remain open. See latest HANDOFF for exact evidence, failed width experiments, source commits and safe NEW controls QA profile. All16 fresh Mac notes/37IDs and17 iPhone notes/47IDs/tags unchanged. Do not restore the now-stale prior study QA baseline.

## 2026-11-19 — Compare drag interaction increment

Mac native Compare now lifts its rendered visible column using NSDraggingSession rather than a reconstructed preview. Independent KJVA/LXX reorder/restore, native move operation, Escape cancellation, passage picker and verse-selection actions verified. This is bounded interaction parity; pinned/aligned/stacked/Strong’s/text-selection/2x/physical feel matrix remains open. No iPhone runtime or data changes this increment. Both targets build; details in HANDOFF and NATIVE-COMPARE-DRAG.md.

## 2026-11-19 — Repeated Compare drag correctness

Source bbca520f fixes stale recognizer source identity after reorder, finishes the native gesture lifetime and masks stacked drag images to the actual source fragments. Real aligned/pinned consecutive moves, invalid-drop recovery, rendered Strong’s link and temporary three-column stacked reorder/return verified; both builds pass. Temporary column removed and reading states restored;16notes/37IDs/alltags unchanged. Blue verse-control image fidelity,2x/selected/text-selection/4column/race/physical cursor matrices remain open. Exact evidence in HANDOFF/NATIVE-COMPARE-DRAG.md. Previous718d9e2e CI44665586360 is green; new head’s checks are separate.

## 2026-11-19 — Table-safe Notes and minimal iPhone keyboard controls

713bd02e protects real note tables from paragraph/list/callout/nested-table edits and disables corresponding native controls.1b9a4074 groups the iPhone accessory into6prose/5table controls, keeps formatting in a native menu, provides contextual table operations/live cell navigation, direct keyboard dismissal, Undo/Redo availability and haptics preference support. Both final builds and265tests pass. Actual Mac shortcut/table/prose/Undo and iPhone row/column/format/Undo/Redo/navigation/heading checks passed. Original16Mac/17iPhone notes,37/47IDs/tags unchanged; disposable notes trashed/tabs closed. See HANDOFF/NOTES-KEYBOARD-AND-TABLES.md for exact scopes and open device/rich-edit matrices. d6422697 adds opt-in raw Compare diagnostics; direct pixels supersede the earlier missing-number preview interpretation. Latest owner marker/hover/replacer/auto-block requests remain OPEN in FOLLOWUP.

## 2026-11-19 — Study markers and automatic dictionary blocks

Automatic lexicon block presentation now implemented/tested on Mac+iPhone. Typed expansion remains distinct from presentation and tracking. Canonical Scripture-block recognition and noteScriptureBlock/threshold settings still missing. Word Replacer browser is implemented, individual/custom rule persistence/propagation is not. Marker preview covers personal citations, not all TSKe sources. See NOTES-AUTOMATIC-BLOCKS.md; do not close whole reference parity.

## 2026-11-19 — Aligned cited-passage previews

Personal-note margin previews now resolve actual target passages, with reader-consistent LXX number/title handling. Actual two-passage and scroll-anchor checks passed. This is not all-source TSKe hover parity, continuous hover proof or all range/combined-record coverage. Automatic Scripture blocks still NOT delivered; draft scanner is documentation only, not app/package code.

## 2026-11-19 — Verified Scripture blocks and iPhone Settings (7e8142f9)

Both native editors now canonically verify and style copied Scripture without changing source, with original false/0.9 settings, cancellable/debounced bounded verification and complete LXX/range selection. iPhone Settings gains six native category routes. Full290sharedtests/finalMac+iOSbuilds PASS; actual Mac/Simulator source/Undo/settings/table/duplicate/rejection checks PASS. All owned fixtures trashed/extra tabs closed; existing19/24note-row hashes,37/47activeIDs/alltags preserved. See SCRIPTURE-BLOCKS-2026-11-19 and CURRENT-STATE for precise proof, runtime and limits. Full rich-import/read-only/index parity remainsOPEN. Next fix LXX attachment display, iPhone dock after editor removal and Mac viewport drift; no Apple voices/merge action. Broad migration remainsACTIVE.


## 2026-11-20 — Reader-aligned note labels and iPhone editor removal

Source334eafbb: native LXX Psalm attachments use reader labels/ranges while raw IDs/legacy golden formatter remain unchanged. Owner-scoped editor teardown fixes tested iPhone focused-note Trash/dock recovery without restart. Six new regressions;296shared tests/both builds PASS; real Mac+iPhone label/link checks and iPhone accessory-keyboard workflow PASS. All20/25prior notes,37/47active IDs/alltags preserved, owned fixtures recoverablytrashed. Physical/software-keyboard/multiple-editor UI matrix and Mac right-divider return drift remainOPEN. See [evidence](NOTE-LABELS-EDITOR-LIFECYCLE-2026-11-20.md) and CURRENT-STATE for live review/CI/runtime. Owner completed final Ollama shortcut removal; verified absent. Broad migrationACTIVE.


## 2026-11-20 — Presenter/Messages/iPhone polish checkpoint

See [focused evidence](PRESENTER-MESSAGES-POLISH-2026-11-20.md) for source commits, actual UI scenarios and precise limits. This increment improves U07/U09/U18, iPhoneS02/S04/S08/Q09 and tab previews; it does not mark those broad features complete. Full339 shared tests and both visual builds pass; original notes/tags/folders/active IDs preserved. Wider physical, accessibility, reference, failure and constrained/manual resize matrices remain open.


## 2026-11-21 — Bounded follow-through, not full closure

Presenter now follows reader typography/appearance and later scrolling despite retained selection (a4fcc429); pause holds effective color scheme until Resume. Mac actual follow/pause/font/number/theme cases pass. Compare focused-secondary source remains OPEN. Markdown image previews preserve trailing text/consecutive images (16067d57;2regressions;346shared tests); iPhone actual image flow and mid-paragraph image layout remain OPEN. Print custom fraction entry/accessibility and native theme menu names are implemented in da8aecce, with actual Mac/iPhone0.125→0.375 behavior; paper output/unknown-field runtime/custom-dark accent semantics need further checks.81938ff0 sanitizes presentation excerpts/replies and retains existing service summaries without rewriting raw Chat data; Mac owned fixture search/reply passes, iPhone matrix open. Detailed evidence: PRESENTER-REFINEMENT-2026-11-21.md.


### Nov21 Presenter follow-up — source1e9eeed7+6a50adc6
Settled reopen now uses the retained reader viewport; live observation remains subscribed and grouped zoom controls expose distinct names/actions. Mac build and actual reopened13→19/livefollow/zoom actions pass. Cold startup with restored audience still starts at top before reader settles: explicitly OPEN; source seeding alone did not fix it. Compare active-secondary projection and explicit same-chapter jump matrix remainOPEN. Detailed next implementation packet in PRESENTER-REFINEMENT-2026-11-21.md. Original QA rows and exact37/47activeIDs preserved. Broad goalACTIVE.


### Nov21 startup correction — ada385b1
Supersedes reproduced startup selection-overwrite above: transient highlight snapshots no longer request focus; deliberate verse selection/clear/destination still does. Both builds PASS; actual fresh startup stays at savedverse7/selected1, explicitverse8 focuses8; original state restored. No persisted format/schema changes. Wider multi-window/paused/edition/history matrix remainsOPEN. Focused evidence has exact scope and next steps.


### Nov21 confirmed history offset gap (OPEN)
Finalada385b1 actualCmdLGenesis1:20/currenttab/Presenterfollow PASS. Back→Genesis1:1 returnsscroll0 rather than prior509pt/verse7. History snapshot keeps viewport but ignoredcache shadowsit, selectionobserver reveals1 and same-passage native viewportrestore is not triggered. Next fix needs scoped one-time restoration across bothadapters, not cache-only change. Full implementation/test packet in PRESENTER-REFINEMENT-2026-11-21.md. FinalQAselection/viewport restored; no extra tabs.


## 2026-11-21 — Paused Compare columns checkpoint

Local source6fbba670 keeps iPhone Compare side by side with horizontal overflow, compact matching headers/cells, tighter inline verse numbers, no per-verse ellipsis, and complete compact-row selection bounds. Global Close Column is e31b8d87. Shared layout arrivals preserve verified raw verse/source-grid identity instead of stale incompatible offsets. Final Mac+iOS builds pass. Actual iPhone horizontal/vertical scrolling, Sync off/on near10, close3→2, survivor retention and joined text-tap selection verified in bounded scope; final compact selection includes its first number. Mac final runtime, pinned→following and explicit-jump/rapid/accessibility checks remain open. Owner requested pause; not pushed. Next design request is Compare grouped naturally with passage picker. [Precise checkpoint](COMPARE-VIEWPORT-2026-11-21.md).


## 2026-11-21 — Discoverable iPhone reading controls

Source0819f846 adds direct Strong’s left of passage picker and Compare/Manage in the existing top row, removing the extra44pt Compare band. Both chapter arrows always remain; long names wrap in two lines, LXX appears on the edition-switch button. Actual Simulator Song of Solomon1LXX full-title/Strong’s on-off/lexicon lookup/CompareExit passes; build scopes and remaining375pt/VoiceOver/physical checks are in [focused evidence](IOS-READER-CONTROLS-2026-11-21.md). The ordinary changing foreground gap remains OPEN (measured AEL case stable; no inset hack). Source3bb05740 further widens iPhone-only text with6/10/22pt insets; desktop widths unchanged. Rejected arrow-hiding and separate-LXX-row candidates were not committed. Broad migration active.

2026-11-22 Compare follow acceptance: saved following columns now track passage changes while Compare is closed on both platforms. Actual Mac Back/Forward and iPhone mixed independent/following reentry pass; historical ambiguous records, durable viewports and broader matrix remain open. [Focused evidence](COMPARE-REENTRY-2026-11-22.md).

2026-11-22 rich note previews source7ccbc3ca: both apps use rich rows/cards, iPhone tab thumbnails and peeks retain table grids rather than raw Markdown. Mac gallery/history and iPhone table peek/tab/tap checked; final button role verified, both builds and10focused checks pass. Remaining physical/accessibility/content matrix is in [focused evidence](NOTE-PREVIEWS-2026-11-22.md). No full Notes parity claim.


Nov23 final follow-up: owner rejected excerpts with too little context. Final source `6fc04d7e` keeps bounded surrounding phrases; actual rebuilt Mac H776 confirms readable context and visible matches. Final Mac/iOS context builds and372package tests passed. iPhone snippet and broader interaction checks remain open; see CLAUDE-AUDIT-2026-11-23.md.


## Nov23 — per-visit Compare reading positions

Source `d349bf41` records immutable passage-scoped viewport maps in in-tab history, reruns same-mounted restoration and protects saved bookmarks from early/stale callbacks. Both native builds and extracted snapshot probe pass. Actual Mac independent Compare→lexicon→Back retains logical verses; two separate visits to the same Exodus32 comparison remain distinct through Back/Forward. Exact independent intra-row pixels, durable restart storage, iPhone history runtime and aligned/stacked/rapid/selection matrices remain OPEN. See COMPARE-VIEWPORT-2026-11-21.md and COMPARE-PERSISTENCE-NEXT-2026-11-23.md. No sync/schema/identity changes; original QA rows and37/47active tab IDs preserved. Broad migration ACTIVE.


## Nov23 — durable semantic Compare bookmarks

`5f83fd65`/`ccab93fc` add bounded device-local anchors keyed by stable column identity and passage, preserving exact per-visit history priority. `e17c1762` keeps column metadata in legacy Compare and persists identical-destination reorders. Both native builds,377sharedtests,5802legacytests, typecheck and lint pass. Actual Mac independent/aligned cold and swapped-column cold; iPhone aligned cold and distinct-visit Back/Forward pass. Exact independent intra-row positions, Mac stacked/iPhone independent and wider jump/reflow/accessibility matrices remain OPEN. No schema/signing/corpus/production writes; watched QA original content and37/47activeIDs retained. [Architecture, failures and exact evidence](COMPARE-DURABLE-2026-11-23.md). Broad migration ACTIVE.

## 2026-11-23 — Scoped verification extension
- Compare independent per-column within-verse restoration: IMPLEMENTED. VERIFIED Mac exactcoldfractions+distinct Back/Forward and owned iPhone partial3/4 cold visual replay. Layout-mismatch semantic fallback has focused model tests; full runtime reflow/rapid/accessibility matrix OPEN. Cold-afterolderBack activevisit persistence OPEN and required.
- Lexicon occurrence excerpts: IMPLEMENTED shared Mac/iPhone single wrapping word range. VERIFIED compact/fullMac and narrowfulliPhone context/highlight; focused6tests/9cases. iPhonecompact visual matrix OPEN. Fullcopy/Find source preserved, no new clipboard runtime claim.
- Rich Notes slash atomicUndo/contexttable: VERIFIED bothplatform runtime; wide-table/IME/VoiceOver/Board/PDF matrix OPEN. See Notes packet; no new Notes source this slice.
- Native install handoff: every AI must verify owner-folder artifacts and end with Mac/iPhone commands. Mac/devicebuild and strictsignature checks PASS; physical installation/behavior remains owner/device testing scope.

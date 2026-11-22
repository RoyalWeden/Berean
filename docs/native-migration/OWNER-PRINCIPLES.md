# Current owner principles

Curated from the owner’s direct instructions through2026-11-19. Read with [AI-CONTINUITY](AI-CONTINUITY.md). This is a living decision record: add new instructions and explicit supersessions, preserve the reason for a change, and verify implementation separately in [TASKS](TASKS.md)/[parity](FULL-FEATURE-PARITY.md). These principles do not mean every feature is finished.

## Mission and continuity

Build substantial actual native Swift improvements in **both macOS and iPhone**, preserving the original Electron/Capacitor functionality and data compatibility. Better native workflows are welcome; recreating clutter or bad behavior is not mandatory pixel parity. Keep the legacy apps buildable. Do not substitute another Claude prompt or an audit for implementation. Work iteratively for sustained periods, test real interactions, and keep durable notes for every successor AI. HANDOFF is the one entry point the owner gives Claude.

Protect production data/sync/identities and existing review guards. The owner permits ordinary reversible implementation/testing/pushing draft work; do not keep stopping to ask whether to continue. Do not merge under that broad permission. Do not claim completion, verification or background work that evidence does not establish. No quota resets.

## Reading and native controls

- Minimal, coherent native controls. Use glass/translucency where it helps floating chrome and grouped controls; retain contrast and readable Scripture. Do not turn everything into opaque panels or random materials.
- Scripture top bars and find/selection controls genuinely float **over** flowing verse text. Add only the scroll clearance needed to reach the final content; do not end the reading text above the action bar. Top background lets Scripture remain visible/translucent.
- Keep the Mac passage/book picker in the top bar. Keep sidebar toggle and Back/Forward grouped in the sidebar title area, including its collapsed behavior. The owner explicitly reverted relocations; do not move them again without a new reason/direction.
- Remove unnecessary carets (passage/layout/actions controls as specified). Group related toolbar actions, avoiding a long undifferentiated row. Uniform icon weight, neutral styling and coherent hover treatment; Share/Highlight should not arbitrarily use different colors/materials.
- **Latest cursor direction supersedes the old “hand everywhere” goal wording.** Use stable native cursors appropriate to the actual hit: ordinary arrow on empty sidebar/Notes space, I-beam on text, resize on dividers, clickable/link affordances where appropriate. No flicker, giant ancestor hand regions or global cursor forcing. Native menus must own hover feedback on the control, not a non-live label.
- Tab/chapter returns should appear ready at the saved position, with no top-bar flash, delayed scroll jump, inspector reopen animation or repeated loading flicker. Audit every tab family and state, not just Scripture once. Strong’s/LXX toggles retain the user’s reading anchor. Scrolling and release/momentum/pull behavior must remain smooth. Chapter pulls must work in short chapters and all supported texts, including LXX; slow pulls must not immediately disarm/disappear.

## Selection, annotations and references

- Adjacent selected verses form one rounded dashed outline, faint interior fill and a slow unobtrusive moving dash. Respect reduced motion. This must look distinct from native text selection.
- Verse action bar is minimal, spaced, native/glassy, with consistent buttons and hover feedback; it must float without reserving the verse-text area. Compare selection should use the same pattern.
- Native text selection copies/highlights actual verse text, excluding verse numbers, gutter padding, trailing line space and controls. Keep continuous cross-verse selection. Strong’s links remain individually tappable/clickable.
- iPhone can select several verses by tapping **body text or number**, with visible actions; a single-number-only selection workflow is insufficient.
- Tags should not disrupt reading. Indicators must truthfully distinguish attached notes, related passages and mentions elsewhere. Hover should show the actual cited passage from the verse note. A chapter tag/reference must not be presented as an attached note. Latest source1f4e7361 separates these categories; do not restore the generic dot/note labeling merely from an old design document.
- Cross-reference sections open by clicking the row/section, not just a tiny caret. Source choices are direct source names without redundant “Cross reference source” wording. Filter controls are compact, accessible and visibly interactive. Copy is called Copy and includes no edition label unless LXX, as requested.
- Single-book texts (such as Apocalypse of Elijah) open their chapters directly; single-chapter books open the passage. Do not ask the user to choose a text again after choosing it. Keep uncommon writings/prologues reachable.
- LXX Psalms show superscription and opening body together consistently with the reader’s intended numbering. Keep raw stored annotation identities intact; use shared mapping for display/navigation/Compare/copy/previews/Notes. Other LXX/KJV differences should be quiet, understandable metadata, not distracting clutter. DATA-01 Hebrew article reuse is a data-pipeline issue, not license for an app-side content guess.

## Tabs, workspaces and command search

- Reduce tab/workspace accumulation and the burden of unnamed workspaces. Ordinary reading/search/navigation should not feel like constant New Tab creation. Use discovery, previews, filtering, intentional reuse and reversible archive/cleanup; never silently delete the owner’s study context.
- iPhone dock is minimal and icon-focused, with no unnecessary button text or big New Tab-centered workflow. The Scripture header also omits the edition name except LXX. Preserve useful fluid iPhone chrome behavior without making state restoration reanimate. Modern creative changes are allowed if functionality remains easy to find.
- In tab rows omit the text/edition badge except LXX. Keep badges away from titles so they do not cause premature ellipsis. Pinned/LXX trailing affordances make room for Close on hover, retaining their resting alignment.
- Tab filters include tab types and are simple to navigate. Double-clicking empty tab-bar space opens floating search for a new tab.
- Command-L edits/replaces the **current tab**, across tab-type combinations, prefilled with its current location/query/title selected. It must not create a tab or switch/edit a different existing match instead. Explicit New Tab remains intentional. Test combinations and history.
- Floating search is Raycast-inspired, glassy, top-anchored while typing, auto-focused, hover-selectable and dismissible by outside click/Escape. Input text is modestly sized. Footer controls are taller, comfortable pills; show action labels such as Switch to Tab/Open in New Tab when accurate, and the Actions Command-K shortcut rather than a caret. Dim the whole window/title chrome consistently without an overly dark/opaque backdrop.
- Advanced search scope/Options belong together at the right of or inside the search field, with organized unclipped filters. Search controls stay at the top when no results are found. All Texts means every installed text; matched substrings should be highlighted, not only whole-word matches.
- Find floats below the top controls, is glassy, opens on type-to-find in Scripture and dismisses after inactivity without stealing editing input. Back/Forward must restore the prior search/result anchor and scroll position immediately; opening Scripture from Lexicon must preserve Lexicon in history.

## Notes and Lexicon

- User-facing name is **Notes**, not Notes Home. Home/folders feel like a spacious, clean native Notes app. Simplify duplicate filters; full folder rows are easy to open. Empty folders center their empty state both ways; nested folders default collapsed with clear expansion.
- Daily Notes need calendar-oriented discovery and date-aware creation; Verse Notes can create notes. Preserve daily-date keys and existing note identities.
- Rich clean editing, normal note/system font except actual code, real formatted tables, accessible quick formatting and pleasant keyboard shortcuts. No Markdown viewer/eyeball toggle. Markdown syntax may be a typing shortcut, but raw formatting markers should not be the visual editing experience.
- Keep saved Markdown/source compatible. Formatting must not reserialize whole notes, break tables, rename wiki identities or disturb user text. Use safe UTF16 edits and coherent Undo/Redo. Table controls become row/column actions in a cell; paragraph/nested-block insertion must not split a table row.
- Automatic Scripture/Strong’s links, suggestions, visual blocks and backlink tracking are **separate features**. Respect settings and original grammar; do not call a plain link or manually inserted text full automatic-block parity. Scripture blocks need canonical-text verification, safe async invalidation and legacy threshold semantics. The preserved draft is not delivered code.
- Notes inspector needs clear groups, compact scope/sort, an accessible filter in/near search, small chapter scope control, and useful references/tags without dense clutter. Share menus/popovers anchor at their button, not window center. Version history should look native and readable.
- Lexicon/side panel need consistent edition/book/filter structure and readable occurrences, matched-word highlighting (including partial-word search matches), visible Strong’s link affordances, and a native search-Scripture action. Avoid repeated Strong’s labels; navigation buttons belong with the top controls. Info button matches the control family. Preserve natural English/Hebrew selection direction.
- Read Aloud must use the intended higher-quality neural voice pipeline. **Do not use Apple system voices as the app’s Read Aloud fallback.** This does not remove accessibility support.

## Compare and broader layout

- Grab/reorder whole Compare sections naturally, with no dedicated little drag handle. The rendered block lifts as a unit with its actual look and pickup offset; do not center the cursor or leave a stationary imitation behind. Preserve verse numbers, colors and other columns.
- Closing the last additional Scripture split disables Compare. Do not offer nonexistent chapter/edition combinations (for example a missing LXX New Testament chapter). Selection/actions work independently for each compared text.
- Dragging an existing tab onto content with a split preview must eventually work for all intended tab combinations and persist safely. Current model/focus tests alone are not proof of live hosts, editors, drag preview, routing or persistence. Follow [TAB-SPLIT-DESIGN](TAB-SPLIT-DESIGN.md).
- Sidebar/study pane minimum widths must contain their controls; dividers need a stable resize cursor. Preserve the owner’s current layout when testing.

When an item is improved, retain this principle, update the evidence/status and record deliberate replacements. Do not silently revert a working choice to a stale screenshot or a different AI’s default taste.

## 2026-11-21 — iPhone Scripture top edge

Owner explicitly requests no full-width top-bar blur on iPhone Scripture. Keep text clear between floating controls; only the individual glass controls blur text beneath their bounds. This supersedes any broad automatic top scroll-edge blur. Preserve existing Mac toolbar design. Owner also reported a physical-phone termination watchdog; investigate actual lifecycle evidence and do not dismiss it as harmless or claim simulator tests prove hardware stability.

## 2026-11-21 — Faster desktop search and wider iPhone Scripture

Owner observes titlebar dimming ahead of content and a slow floatingsearch open. Dim together in one presentation update; opening should feel immediate while retaining glass, autofocus, CmdLselection, outsideclick and Actions. Owner requests slightly reduced iPhoneScripturesidepadding so verses span wider; retain numbergutter/selectionoutline and distinctwidthpresets. Macreadingwidthunchanged.

Owner clarification (2026-11-21): the reduced Scripture margins apply to iPhone only. Verified change 0d6c0ad3 changes phoneInset from 12/20/32 to 8/14/26; only IOSChapterTextView consumes it. Mac ChapterTextView still uses max(20, (width - macMaximum) / 2), with unchanged 920/760/600 width caps. Do not propagate the phone reduction to desktop. No desktop rollback was needed.

Owner steering (2026-11-21): iPhone Compare must remain side-by-side columns, including narrow screens. Preserve column identity and useful reading width; allow horizontal movement for extra columns instead of vertically stacking editions/whole passages. Keep synchronized verse alignment, independent passage controls, selection/actions and accessibility intact.

Owner resumed 2026-11-21: iPhone Strong’s must be easy to discover, preferably to the left of the passage picker. Audit excessive top gaps that change after app foregrounding. Long book/chapter names must remain readable with the available controls; avoid crowded or tiny text. These requests are iOS-only.

Owner correction (same resumed session): adding Strong’s and Compare must NOT hide previous/next chapter buttons on iPhone. Keep both arrows visible; adapt the title instead. Supersedes the uncommitted ViewThatFits toolbar fallback that hid arrows.

Owner clarified “wider margins” means wider verse text, with less space at the edges. iPhone-only width presets now use6/10/22pt side insets (previous8/14/26). Desktop width caps920/760/600 and native inset formula remain unchanged.

Owner explicit copy contract (both Mac and iPhone): audit all verse-copy actions against original. Single verse puts reference and verse text on one line. Multiple verses put book/chapter/verse range on first line and each verse on its own following line; preserve fuller original semantics for ranges/gaps/editions and rendering preferences. Do not treat this as iPhone-only.

- 2026-11-22: Note previews must render rich content rather than Markdown source, on Mac and iPhone. Keep code styling where intended; preserve note storage and editing compatibility.

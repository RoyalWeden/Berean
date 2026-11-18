# macOS cursor audit — 2026-11-18

Status: replacement source implemented; focused build/UI verification in progress. Full physical-motion matrix remains open. This supersedes the old “hand on every clickable thing” requirement: the user explicitly asked for native judgment and no flicker.

## Evidence and root mechanisms before replacement

`apple/BereanMac/ClickableCursor.swift` installs global method exchanges on NSButton, NSSegmentedControl, NSSwitch, the private NSToolbarItemViewer class and NSApplication.sendEvent. It also observes every window update. After native event dispatch it hit-tests the window, checks a weak registry of SwiftUI cursor regions and sets the cursor immediately and again on a main-queue pass. Toolbar enabled state can be obtained through the private item selector. This is an additional cursor authority on top of AppKit/SwiftUI and native text tracking; it can override a cursor that the actual control just selected. Previous patches fixed false-positive region geometry, but do not remove these competing owners.

`apple/Shared/ScriptureView.swift` defines clickableCursor with a .link pointerStyle plus ClickableCursorRegion background. The helper appears on toolbar controls, menus, buttons, filter options, tab rows and some containers. Its name/behavior assumes the old hand-everywhere policy. A passive broad container must never impose a hand on whitespace, text editing or resize areas.

`apple/BereanMac/ChapterTextView.swift` has separate native text/link cursor tracking, excludes toolbar hits and no longer registers a blanket I-beam rectangle under floating controls. Preserve that separation. `RichNoteEditor.swift` gives actual text links a pointing-hand cursor. Column dividers in Compare and split dividers have resize semantics. Do not flatten these into a universal arrow either.

Baseline `/tmp/berean-mac-psalm119-scroll-baseline.txt` sampled Mac QA during automated Psalm119 wheel down/up: main thread mostly idle and many non-idle samples were accessibility enumeration; only one scrollWheel sample and one StableClickableCursor sample. This does NOT establish a sustained scrolling bottleneck or an FPS result. CUA sends short synthetic wheel bursts, not a continuous physical trackpad stream. Do not cite this as proving the user's choppiness fixed.

## Chosen native policy

| Element | Cursor owner / expected behavior | Why |
|---|---|---|
| Toolbar button, menu, toggle, segmented picker, checkbox, dialog button | Native arrow; native hover/pressed/disabled appearance | These are controls rather than web links. Enabled state does not need a separate global cursor override. |
| Sidebar tab, note card, folder row, command-palette result | Arrow with clear row hover/selection; full click target | Selection/navigation rows are not prose links. Dragging uses a drag preview, not a permanent hand over the entire list. |
| Readable/selectable Scripture or Notes text | Native I-beam when text selection is possible | Preserve partial text selection and its native handles/menu. |
| Inline Strong's, Scripture reference or note hyperlink | Pointing hand over actual link glyph bounds | Links are explicit navigation targets. Whitespace after a line must not inherit the link cursor. |
| Split/Compare column divider | Horizontal/vertical resize cursor in a narrow stable target | Preserve resize affordance and keep it out of adjacent text. |
| Text field / Notes editor / Find field | Native text insertion cursor | A parent control/container cursor must not win over the editor. |
| Empty sidebar/background/titlebar drag space | Native arrow | No text/link/resize action exists there. Window drag still works. |
| Disabled control | Native disabled appearance and arrow | No fake active hand. |
| Drag in progress | System drag cursor and native operation feedback | Do not override copy/move/forbidden feedback after dispatch. |

## Implementation plan

1. Retire global control/private-toolbar/application-event cursor overrides. Native controls keep their cursor rectangles and enabled-state behavior. Do not replace one swizzle with another.
2. Convert the existing helper to a narrow native-control/default cursor policy, or remove redundant uses. Preserve explicit link and divider policies at their actual targets. Never attach the replacement to an entire editor/content root.
3. Retain optional DEBUG diagnostics as observation only: actual cursor, hit category and coordinates. Diagnostics must not call NSCursor.set, modify global control classes or steal event handling. No production trace files or user text.
4. Audit all helper call sites by element category, especially nested buttons/labels, disabled Back/Forward, toolbar glass, popovers and sheets. Remove redundant/conflicting pointerStyle modifiers. Verify unrelated app windows are unaffected.
5. Keep reader native text/link hit testing local. Check linked numbers, Strong's suffixes, title verses, verse/body gaps, trailing line whitespace and the floating action bar. Avoid broad cursor rectangles spanning the whole reader.

## Required runtime matrix

For each surface below: enter, move within icon→padding→label, leave into whitespace, cross child boundaries repeatedly, press/drag/release, and change enabled state without moving the pointer. Check both active and inactive windows, sidebar shown/hidden, light/dark, Reduced Motion and native glass backgrounds.

- Every top-bar grouping in Scripture, Compare, Notes root/folder/editor, Lexicon detail/search, Scripture Search, Calendar, History and Tags.
- Selection action bar: each button, highlight menu, share menu and their padding/gaps; selected verse outline/body and partial native text selection.
- Compare: title/passages, actions menu, whole-block drag preview, valid/invalid drop targets, resize divider, selected verses, independent scrolling.
- Notes: folder expansion vs row navigation, empty-state button/background, cards, formatting menu, checklist/table cells, links, selection handles, code spans and editable title.
- Lexicon/Search: filter pills/options, occurrences rows, reference links, empty results, disabled pager, floating Find/Go and result actions.
- Sidebar: pinned/LXX hover slide, close/unpin targets, reorder, blank window-drag area, search/filter field, workspace menu, archived tabs.

A click screenshot alone does not prove continuous cursor stability. Record a physical-motion pass or a diagnostic event stream spanning the interior boundaries. CUA clicks/tiny drags previously failed to produce a reliable hover preview; label those limitations honestly. Do not claim “never flickers” until native-motion evidence covers this matrix.

## Implementation checkpoint (2026-11-18, after published74aeb6c5)

Removed the NSApplication/control/private-toolbar method exchanges, global window-update cursor watcher, weak SwiftUI cursor-region registry, private toolbar-item selector and post-event cursor writes. Existing clickableCursor call sites now use an identity compatibility helper; AppKit/SwiftUI retains ownership, including over nested labels/padding and disabled controls. Explicit native text/link tracking in ChapterTextView/RichNoteEditor, Compare columnResize and sidebar drag-space arrow remain. No blanket default pointerStyle is added around editors.

The remaining ClickableCursor.swift file contains only opt-in DEBUG NativeCursorDiagnostics (BEREAN_CURSOR_TRACE). A local event monitor returns every original event unchanged and writes a bounded64-sample ring of actual cursor/event/coordinates/key-window state, with no user text, private API or cursor writes. Normal builds do not install a monitor. First Mac diagnostic build failed because String(CGFloat) has no matching initializer; corrected to String(describing:), then Mac build passed. New native-palette field build is still live in /tmp/berean-native-palette-field-mac.log and iPhone /tmp/berean-body-tap-priority-ios.log. Do not confuse the earlier field-focus experiment with verified final behavior.


Final checkpoint: commit3c38eb5c removes the global cursor machinery. Both final local builds passed (`/tmp/berean-study-close-final-{mac,ios}.log`). No physical pointer-motion samples were captured; button-interior flicker, active/inactive windows, menus and overlay transitions still require that runtime matrix. Native cursor policy is implemented, not universally runtime-verified.


Final reader checkpoint: both direct-repo final grouping builds passed and Mac input/copy/range UI checks passed. This does not establish physical cursor-motion/flicker coverage; that matrix remains open. No global cursor override was reintroduced.

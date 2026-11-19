# Native sharing audit — 2026-11-19

## Verified fix

Mac NoteDetailView's Share menu formerly hosted ShareLink inside transient menu content. It now keeps NativeShareAnchor behind the stable toolbar Menu and sends a uniquely identified NativeShareRequest after the menu closes. The retained native NSSharingServicePicker presents relative to that anchor. Actual Mac screenshot/AX confirms it is attached beneath the share button, including repeated presentation/cancellation. No recipient or external share service was invoked.

Ordinary Notes sharing now uses readable title/body through noteExcerptText, on Mac/iPhone editor and single/bulk Notes list actions. Native preview no longer exposes YAML metadata. Copy as Markdown and Export as Markdown retain their explicit source/identity-preserving behavior. Tables become readable row/cell text in ordinary plain-text sharing; this is not rich-table export. Source files/database remain unchanged.

## Remaining surface matrix

| Surface | Current path | Verification still needed |
| --- | --- | --- |
| Mac Notes editor | Stable native toolbar anchor | Width/overflow/multiple-window/rapid-navigation matrix; unsaved-title change uses current title in final source, build checked |
| iPhone Notes editor | ShareLink readable text | Actual activity sheet/source positioning and cancellation |
| Notes single-row context menu | ShareLink inside nested Menu | Native context-menu anchoring; row may need stable parent anchor |
| Notes bulk selection | ShareLink | Both platform source anchor, multi-note text boundaries |
| Scripture chapter | Async SharedScriptureChapter via ShareLink in menu | Stable toolbar anchor and asynchronous stale-target handling |
| Scripture selected verses | SharedVerseSelection via ShareLink | Reader action menu/sheet anchor; preserve actual selected edition/ranges |
| Scripture iPhone verse sheet | ShareLink plain verse | Activity presentation/cancellation |
| Search result context menu | ShareLink reference + displayed text | Source row anchor and Word Replacer consistency |
| Compare selection | SharedVerseSelection ShareLink | Actual selected column/edition anchor and cancellation |

Do not substitute a window center or a newly looked-up global key window for the actual source control. The native Mac anchor is reusable for synchronous string payloads; async chapter preparation needs an intent guard if the tab/selection changes. Keep export panels separate from sharing. No blanket claim that all share anchors are fixed.

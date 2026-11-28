# Verse study indicators — November 26, 2026

The Mac reader now draws a rounded hover surface for the study marker using its TextKit attachment bounds. The native popover respects macOS Reduce Motion. The popover uses the marker’s glyph bounds as its anchor. The earlier input-client `firstRect` returned a surrounding line/caret rectangle in the observed case, and live QA showed the arrow above the marker.

Preview loading remains lazy. Linked passages lead the card. Attached notes and notes that mention the verse provide rich excerpts when space remains. Note IDs prevent repeating a source note already identified by a linked passage or adding the same note twice. The card displays up to three items. This slice does not change note content or the storage model.

## Verification and remaining work

The first Mac cosmetic build passed. On the isolated Genesis 1 fixture with a tag and an indirect note reference, the live preview exposed the misplaced arrow that prompted the glyph-anchor change. Corrected Mac build56751 passed. Live QA Option-click showed verse2’s native popover at the corrected glyph anchor, with a note title, reference, emphasis/highlights, code and checklist rendered through the rich Notes excerpt renderer. Ordinary marker click opened Cross Refs for Genesis1:2 and its mentioning note. Back restored Jeremiah33:11 and its Notes pane. No notes were created or edited. The Simulator build also passed, covering shared compile compatibility; no iPhone indicator behavior changed.

Option-click in the explicitly flagged `--qa-library --qa-study-preview` build can open the actual Mac popover for visual content and anchor checks. This tests the rendered card and geometry. Continuous physical hover, dwell and exit still require observation. Verify dark mode, Reduce Motion and accessibility separately. The broader iPhone behavior was outside this Mac UI verification.

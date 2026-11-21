# Note images (N05) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED; Mac VERIFIED, iPhone partly VERIFIED**. Was ❌/❌ (alt text only).

- `BereanNotes/NoteImages.swift`: finds `![alt|wNNN](src)` (original pm serializer format), decodes gif/png/jpeg/webp base64 `data:` URIs (SVG refused, as the original), display size (saved width or natural, clamped, aspect kept), `maskingSources` (blanks image sources at equal UTF-16 length for the reference/Strong's scanners).
- **Bug fixed (pre-existing):** the image regex in `MarkdownLiveSpans` (and copies) used `(?:[^()\\]|\\.)*`, which ICU fails on large base64 (~700 KB), so real images were styled as links showing "!alt|w360". Now an unrolled pattern `[^()\\]*(?:\\.[^()\\]*)*` (escaped parentheses still supported; regression test with a 960 KB source).
- **Perf fixed (pre-existing):** `NoteStrongsLinks.spans` and `NoteVerseRefs.linkSpans` scanned the whole base64 on every keystroke (~2 s per key on a 1.3 MB note). They now get the masked text: about 20 ms per keystroke (measured with `sample`).
- `NoteTableLayout.styleImages/drawImages`: the image draws above its caption inside a tall caption line (`minimumLineHeight`). `paragraphSpacingBefore` does NOT work here because TextKit 1 skips it when the paragraph starts with hidden (null) glyphs. The source is never rewritten. Decode cache key = length + 3 slices (hashing the whole string per keystroke was the next hot spot). Caption = alt text in secondary, small type.
- Verified on Mac (own QA profile `claude-20261120`, note `qa-image-note`): images at 360 pt (`|w360`) and 480 pt (natural), captions below, typing saved, both base64 payloads and `|w360` byte-identical. iPhone sim E8B01B22…: both images render, and the Go result preview no longer shows raw syntax.
- **Fixed after the first commit:** text views restyle once when the text width changes (Mac `setFrameSize`, iPhone `layoutSubviews`); iPhone portrait→landscape verified (second image grew to the wider column, captions intact). Sizing now uses pixel dimensions on both platforms (the original shows images at CSS pixel width), so a 144-DPI PNG no longer renders at half size on the Mac. Fallback width before first layout: Mac 680 pt, iPhone 360 pt.
- **Earlier note (superseded):** reserved height is computed at styling time. Before first layout the width is unknown (fallback: Mac 680 pt, iPhone 360 pt), so after a resize or rotation an image can leave a gap or be scaled inside its reserved space. Fix: restyle when the text container width changes. The iPhone second-image caption was not seen in the last screenshot (likely the old 680 fallback, now 360; re-check). Remote/http and vault `attachments/` images are not loaded; there's no image insert/paste or resize UI in the native editor yet.

## Adding images (follow-up, same day)

- Paste a picture (screenshot / copied image / image file) on both editors → `![image](data:…)` (file → `![file name](…)`), on its own line, exactly the original pm/imageInsert.ts shape; PNG/JPEG/GIF/WebP stored as-is, other formats (TIFF/HEIC) re-encoded as PNG. Mac: `validateUserInterfaceItem` enables Paste for images (plain-text NSTextView disables it otherwise); iPhone: `canPerformAction` offers Paste when `hasImages`.
- Insert menu → **Image…** (NSOpenPanel / document picker) on both apps.
- **Bug found and fixed in testing:** a click on an image line can put the caret among the hidden `![` characters; the first paste split the existing image's Markdown. `NoteImageInput.insertionPoint` now moves insertion after that image's line. The retest inserted cleanly; the existing images stayed byte-identical.
- Verified: Mac paste (clipboard restored afterwards). iPhone paste/Insert Image built, not exercised (the simulator clipboard needs the DeviceHub path). Mac drag-and-drop of picture files: IMPLEMENTED (performDragOperation inserts at the drop point), not exercised (Finder drag not automatable here). iPhone drop and resize handles still OPEN.

## Resizing (follow-up)

- **Image Size** menu (Small 200 / Medium 360 / Large 560 / Original Size; presets wider than the image's pixel width are hidden; the current size is ticked). Mac: the editor's right-click menu on an image. iPhone: first item of the edit menu when the caret or selection is in an image. It writes only the alt text's `|wNNN` (`NoteImages.widthEdit`, tested); a single undoable step; the caret moves after the image markup.
- Verified on iPhone sim: Original → Small → image redrawn at 200 pt, saved `![Cave 4 fragment|w200](…)`, Undo restored `![Cave 4 fragment](…)`. Mac: built, **not clicked** (see HANDOFF incident note).
- OPEN: dragging a resize handle (the original's) is not implemented; the menu is the native replacement. Keyboard suggestions can show base64 fragments while the caret sits inside image markup (minor).

## Drag-resize handle (Mac) — 2026-11-20 (later)
- Caret inside an image's Markdown/caption → accent outline + bottom-right handle (layout `activeImageLocation`); resize cursor over the handle (view cursor rect only, no global cursor change).
- Dragging the handle previews the width live (aspect kept, 48 pt minimum, up to the line width); release saves one **Resize Image** edit (`|wNNN` in the alt, same as the Image Size menu and the original); Escape cancels.
- Verified click-free in the QA library: caret placed via the Accessibility API at the image → outline + handle drawn; caret moved away → cleared. **Drag not exercised by me** (no mouse automation on the owner's Mac) — needs a hand test.
- iPhone keeps the Image Size presets menu (no drag handle).

## iPhone Photo Library — 2026-11-20 (later)
- iPhone Insert → Image now offers **Photo Library…** (PHPicker — out of process, no photo permission prompt) and **Choose File…** (Files). Previously only Files was offered, which is the wrong default on a phone.
- Verified on sim: photo added with `simctl addmedia` → Insert → Image → Photo Library… → picked → inserted at natural width with caption from the photo name (`qa-gradient`); stored as an inline `data:image/png;base64` Markdown image.

## Remote images (later, 2026-11-20)

- `![alt](https://…)` (and http) images — which the original renders as `<img>` — now load in both native editors: `NoteTableLayout.decodedImage` routes non-`data:` sources to `remoteImage`, which returns the cached image or starts one background download (≤ 25 MB, HTTP < 400), then posts `remoteImageLoaded`; each editor coordinator restyles on it so the image gets its space and draws. Failed URLs aren't retried in the session; the Markdown is never changed.
- Read-only previews (`MarkdownText`, e.g. Presenter) use `AsyncImage` for remote image lines (spinner → image, or a "photo" label if it fails).
- Printing still embeds only `data:` images (never fetches during print).
- Verified on iPhone sim: a note containing a Wikimedia PNG shows the image at natural width with its "Dice" caption above the following text; QA note + tab removed afterwards (4 notes, empty outbox/FTS match). Mac editor uses the same layout code and observer (built, not exercised).
- Insert (Photo Library / Choose File / paste) and size presets (iPhone Edit menu → Image Size; Mac drag handle) were already in place. Vault `attachments/` images still depend on vault sync (not ported).

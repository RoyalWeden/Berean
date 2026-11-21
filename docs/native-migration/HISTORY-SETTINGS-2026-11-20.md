# History settings (U12 part) — 2026-11-20 (Claude Code)

- Settings → **History** (Mac pane, iPhone row), port of the original HistorySection: **Pages per tab** (`tabNavMaxStack`, 10–1,000 step 10, default 100) and **Entries kept** (`historyMaxEntries`, 50–10,000 step 50), each with a clear action (back/forward stacks; history log behind a confirmation). Notes and highlights are never touched.
- The four hard-coded per-tab back-stack limits (100) now read `tabNavMaxStack`; the history log prune reads `historyMaxEntries`.
- Data-safety choice: if `historyMaxEntries` was never stored, the native default stays **5,000** (not the original's 500) so turning this on prunes nothing a user already has.
- Not ported from the original Danger section: deleting all notes / imported notes (destructive, sync-dependent wording) — left for an explicit decision.
- Verified on sim: History screen shows 100 / 5,000; + stored `tabNavMaxStack = 110`; − restored 100.

## Print & Export settings — 2026-11-20 (later)
- Settings → **Print & Export** (Mac "Print" pane, iPhone row), port of the original PrintExportSection: presets (Compact / Standard / Spacious / Manuscript), margins (MARGIN_INCHES none 0 / narrow 0.5 / normal 1 / wide 1.5; custom kept if already stored), font size 8–18 pt, font family, paper size (Mac; iPhone chooses in the print panel), include title, color/grayscale — original keys and defaults (`printMarginPreset`, `printCustomMargins`, `printPaperSize`, `printFontSizePt`, `printFontFamily`, `printIncludeTitle`, `printColorMode`).
- Applied by `printMarkup` (notes and the idiom reference book): CSS font/size/colour in the HTML, title removal, `NSPrintInfo` paper + margins on Mac, `perPageContentInsets` on iPhone.
- Verified on sim: Manuscript stored (`wide`, 13, `serif`); a note's print preview showed serif type with wide margins; restored to Standard afterwards.
- Found: inline note images are not included in printed notes (pre-existing; the print HTML is built from Markdown without images) — follow-up.
- Not ported: PDF download location (Electron-only) and the print theme picker.
- Also: the Search hint now retires once Go is used (TipKit otherwise brings a hidden-but-not-closed popover back at each launch).

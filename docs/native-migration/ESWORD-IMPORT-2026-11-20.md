# e-Sword import (N15) — 2026-11-20 (Claude Code)

Status: **IMPLEMENTED + VERIFIED (Mac)**. Original is Mac-only; so is this.

- `BereanNotes/ESwordImport.swift`: port of `electron/ipc/eSwordImport.ts` — read-only study.notx / topic.topx / journal.jnlx, RTF stripper (UTF-16 scanner, Windows-1252, `\u`, ignorable groups, the original's hyperlink pre-pass), e-Sword ref expansion, OLE dates, classify against `esword`-tagged notes (new / updated / duplicate, the original's imported-footer stripping), save through `NotesService.create/update` (id `esw-<uuid>`, type verse/general/daily, verse_ref `BOOK.ch.v`, colour blue, no status, tag `esword`, `imported_at` set).
- Oracle check: the original TypeScript `stripRtf`/`expandVerseRefs` were executed under node on three inputs; the Swift output matches byte-for-byte, including the original's quirk that its HYPERLINK regex does not convert these field groups (link text only).
- UI: File → Import from e-Sword… sheet: choose folder (NSOpenPanel, sandbox-safe, pre-pointed at the detected e-Sword folder), toggles per available file, review list grouped New / Changed / Already imported with Select All / None, Import N, then "Show Imported Notes" (#esword search).
- Tests: 3 (oracle RTF cases, OLE date, read+classify+save incl. second run → duplicate/updated). 313 total PASS; both builds PASS.
- Mac UI verified **without mouse clicks** (menu items by PID, AXPress, typed path, Return): synthetic folder → 4 new → Import 4 → rows exactly as above → second run "0 new · 0 changed · 4 already imported", Import disabled. QA profile `claude-20261120` only; the 4 QA notes remain there.
- OPEN: no cancel/progress UI for very large e-Sword libraries (original had progress events); BibleGateway importer (N14) not ported.

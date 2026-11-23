# Owner decisions brief — what's still blocking parity (2026-11-22, Claude Code)

Everything else on the handoff that could be finished without the owner is done or verified. The remaining parity gaps are each waiting on one of the decisions below (or on a device check). Each entry: what it unblocks, the options, a recommendation. Nothing here has been started; none of it is approved.

## 1. Share Extension + App Group (A03, U17 PDF intake)
- **Unblocks:** "Share to Berean" from Safari/Files/Photos (text, links, PDFs) on iPhone; PDF intake into the PDF library.
- **Needs:** a new extension target, an App Group entitlement for the Dev identity (and later production), provisioning updates. Touches signing/identity — explicitly gated.
- **Options:** (a) Dev-identity-only extension first (`group.com.berean.native.ios.dev`), production later; (b) wait until the native app replaces the Capacitor app.
- **Recommendation:** (a) — it can be built and tested beside the existing apps with no effect on production bundle IDs.

## 2. Widget (A07)
- **Unblocks:** the original iPhone widget (verse/daily note).
- **Needs:** a WidgetKit extension + the same App Group as #1 (shared data).
- **Recommendation:** do it right after #1, reusing its App Group; small once #1 exists.

## 3. iCloud sync in the native apps (A01, H06 highlight sync, OD-5 gates)
- **Unblocks:** native apps sharing notes/highlights/tabs with each other and with the existing apps.
- **Constraint:** OD-5 says continue the existing journal format (Swift port verified against TS). Standing rule: no writes to production iCloud journals without separate authorization.
- **Options:** (a) enable sync on the Dev container only (`iCloud.com.berean.app.dev`) and run the device matrix there; (b) defer until release planning.
- **Recommendation:** (a) — authorize Dev-container sync for testing; production journal writes remain a separate later authorization.

## 4. Ask Berean model-backed modes (G02–G08, C-4)
- **Unblocks:** Commentary ON/OFF, Deep Search, collections/memory, cloud BYO key, online research. (The model-free Ask Berean is already complete.)
- **Options:** (a) on-device Apple Foundation Models where available; (b) the original Ollama/local-model path on Mac only; (c) BYO cloud key; (d) keep model-free only.
- **Recommendation:** decide C-4 scope first; (a) fits "native" best and needs no keys or downloads; (c) needs Keychain storage (A02) and a privacy note (C-7).

## 5. Vault sync with Octarine/Obsidian (N10, C-14, OD-1 layout)
- **Unblocks:** Mac Markdown vault export/import/watch like the original.
- **Options:** (a) port the original exporter + watcher to the native Mac app (OD-1 layout already decided); (b) leave vault sync to the Electron app until retirement.
- **Recommendation:** (a) on Mac only; it's the main remaining Mac-only gap. Needs the folder permission (security-scoped bookmark).

## 6. Notes "Danger" section (delete all notes)
- Deliberately not ported without a decision. **Recommendation:** port as in the original but behind a typed confirmation, or omit permanently — owner's call.

## Device checklist (owner, ~15 min, Berean Native Dev on the iPhone)
1. ~~Psalm 119~~ — **measured on the iPhone 16e 2026-11-22** (temporary timing build, removed afterwards): 13,965 characters, render 11 ms, layout < 1 ms, on screen by the next run loop at 31 ms. Simulator, same chapter: 6–9 ms render, 50–129 ms to next run loop. Nothing left for the owner here.
2. VoiceOver: verses read one by one, double-tap selects, "Verse Actions" action; lexicon section headings in the rotor.
3. Siri/Shortcuts: "Open Berean Native Dev to a passage" / Shortcuts app → Berean actions (the links behind them are verified).
4. Physical keyboard (optional): `/` then Return in a note picks a block.

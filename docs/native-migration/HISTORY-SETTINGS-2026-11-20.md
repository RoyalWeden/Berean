# History settings (U12 part) — 2026-11-20 (Claude Code)

- Settings → **History** (Mac pane, iPhone row), port of the original HistorySection: **Pages per tab** (`tabNavMaxStack`, 10–1,000 step 10, default 100) and **Entries kept** (`historyMaxEntries`, 50–10,000 step 50), each with a clear action (back/forward stacks; history log behind a confirmation). Notes and highlights are never touched.
- The four hard-coded per-tab back-stack limits (100) now read `tabNavMaxStack`; the history log prune reads `historyMaxEntries`.
- Data-safety choice: if `historyMaxEntries` was never stored, the native default stays **5,000** (not the original's 500) so turning this on prunes nothing a user already has.
- Not ported from the original Danger section: deleting all notes / imported notes (destructive, sync-dependent wording) — left for an explicit decision.
- Verified on sim: History screen shows 100 / 5,000; + stored `tabNavMaxStack = 110`; − restored 100.

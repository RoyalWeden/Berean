# 16 — Audit Handoff

For an independent architect who wasn't part of this audit. Read `00` first, then this, then the documents you need.

## Baseline

- **Code:** `d97fb05c31b384d164cc12022e405fa923f263de`, version 0.8.1, repository RoyalWeden/Berean.
- **Investigated at:** `807c2d9`. Differences are PRs #9-#11, which are fixes only.
- **Documents:** merged on top of the baseline, no code changes.
- **Migration status:** not started. Nothing here authorises it.

## Stabilization results

Typecheck, lint, 5,766 tests, desktop build, real app launch, DMG, both Mac App Store builds, signed installer, sandboxed packaged launch, iOS simulator, Swift tests, device and archive compilation all pass. Fifteen bugs were fixed, including four data-loss paths in sync and one in notes. Details and remaining bugs: `01`.

## Documents

| Doc | Purpose |
|---|---|
| 00 | Executive summary |
| 01 | Stabilization record |
| 02 | Current architecture |
| 03 | 105-feature inventory |
| 04 | Database and data migration |
| 05 | iCloud synchronization |
| 06 | Native macOS architecture |
| 07 | Native iOS architecture |
| 08 | Shared Swift architecture |
| 09 | Component replacements, editor, Read Aloud |
| 10 | Performance and resources |
| 11 | Testing and parity |
| 12 | Risk register, 44 risks |
| 13 | Migration options and recommendation |
| 14 | Dependency and code map |
| 15 | Open questions and decisions |
| 16 | This handoff |
| 17 | Security, privacy, release (added; covers brief §2.10) |

## Critical findings

1. **Sync is not CloudKit.** It's a custom JSONL journal in iCloud Documents with hybrid logical clocks. Reusable, if byte-compatible (05).
2. **Hash compatibility decides data safety.** A difference reverts edits on every device, and changing a synced table's columns changes every hash (05 S1).
3. **`berean.db` can stay.** Native SQLite opens it, including FTS5. Keep sync bookkeeping intact (04).
4. **`localStorage` holds user-authored settings** that exist nowhere else (04 §11.4).
5. **DMG and MAS share a bundle ID, not a data location** (04 §11.2).
6. **Documentation is unreliable.** `CLAUDE.md` and mobile docs contradicted the code in several places. Trust these audit documents' labels, and the code above both.
7. **Coverage has real gaps:** no hash golden tests, no vault tests, no PDF tests, no UI automation, five Swift tests (11).

## Migration constraints

- Same bundle IDs, team, iCloud containers and App Groups.
- Same schema and sync format during coexistence, additive only, and no raising the schema number.
- No native writer on real data until conformance and interoperability pass.
- Old apps stay installable and their data unmodified until native has run.
- Development uses Berean Dev identities.
- Scripture text, naming conventions and theological conventions don't change.
- A permanent WebKit wrapper doesn't count as native. YouTube playback is the expected exception.

## Highest-risk features

Notes editor; sync; Read Aloud on device; Scripture text with highlight offsets; Mac workspace and multi-window; Ask Berean.

## Recommended first investigation

**Golden corpus plus three evidence-gathering experiments**, before any plan is finalised:

1. Build a TypeScript golden exporter: sync hashes, journal ops, reference parsing, Markdown round-trips. It unblocks everything.
2. Scan real notes structurally, with a tool that prints no content, to learn how much tables, columns and threads matter.
3. Sweep highlight offsets over real data.
4. Run Kokoro on a physical iPhone: speed, memory, heat, locked screen.

These can't damage anything and could change the plan. See `13` §6.

## Outstanding blockers

| Blocker | Owner |
|---|---|
| Mac route: MAS, Developer ID or both | Product owner |
| Whether Developer ID can hold iCloud Documents | Test |
| Windows users | Product owner |
| eSpeak licence | Legal |
| Sync reuse in JavaScriptCore or a Swift port | Architect |
| Notes editor limits | Product owner and architect |
| Minimum OS versions | Product owner |
| Physical iPhone evidence | Owner's device |
| Real-data access for sweeps | Product owner |

Everything open is in `15`.

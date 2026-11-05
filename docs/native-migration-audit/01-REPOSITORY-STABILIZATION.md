# 01 — Repository Stabilization

Stage 1 record, 2026-11-05. Logs are in `~/Berean-backups/stabilization-2026-11-05/` (`logs/`, `logs-baseline/`, `logs-final/`). The machine is an M5 MacBook Air, 32 GB, Xcode 27.2, Node 24.14.0.

## 1. Baseline

**Final code baseline: `d97fb05c31b384d164cc12022e405fa923f263de`, version 0.8.1.** The audit documents were merged on top of it and change no code.

The baseline is green except for three items that can't be made green here: `npm audit` (section 6), physical-device checks, and anything requiring upload to Apple.

## 2. State before and after

| | Before | After |
|---|---|---|
| `main` | `598ca1d` | `d97fb05` plus documentation |
| Open PRs | 0 | 0 |
| Open issues | 0 | 0 |
| Remote branches | `main` only | `main` only |
| Stashes | 2 | 2, untouched |
| Recovery refs | 4 | 4, untouched |
| Worktrees | 6 | 6 |
| Latest release | v0.8.1 | v0.8.1. Nothing released |

`CHANGELOG.md` holds an unreleased 0.8.2 entry. `package.json` remains 0.8.1.

## 3. Commits merged in Stage 1

| PR | Merge | Commit | What |
|---|---|---|---|
| #8 | `807c2d9` | `2c42c61` | Link safety, atomic vault writes, iOS tests running, MAS from a worktree, hygiene |
| #9 | `0a474e9` | `b93e39b` | Sync data-loss fixes, `chokidar` declared, smoke cleanup |
| #10 | `07556dd` | `07fdb94` | Table cell formatting |
| #11 | `d97fb05` | `3a5123a` | Audio cache key validation |

Each passed CI on its own head. Together they were validated by the full matrix on `d97fb05` in section 5.

## 4. Bugs

### Fixed

| # | Original failure | Root cause | Fix | Regression test | Files |
|---|---|---|---|---|---|
| 1 | An edit made while a push was writing never reached other devices, while status said synced | Push deleted outbox rows by sequence, including a row re-written during the push | Delete only the exact version written | `knownLoss.integration.test.ts` D1 | `src/platform/sync/engine.ts` |
| 2 | New devices lost tag edges at snapshot bootstrap | Records sorted by name, so children came before parents and failed foreign keys | Retry failed records while a pass makes progress | Same file, D2 | `src/platform/sync/engine.ts` |
| 3 | A failed op could become impossible to retry | Manifest acknowledged past a parked op, so its author could prune the file | Cap acknowledgement below the first failed op | Same file, D3 | `src/platform/sync/engine.ts` |
| 4 | An external vault edit could be overwritten by a later remote edit, with no conflict copy | Vault imports wrote SQL without a change event | Emit the event from import paths | No end-to-end test: the path needs Electron | `electron/ipc/vault.ts`, `electron/noteChanges.ts`, `electron/servicesHost.ts` |
| 5 | Bold, links and other formatting in note tables vanished on save | Serializer wrote each cell as plain text | Cells use normal Markdown rules | `roundtrip.test.ts` | `src/components/notes/pm/serializer.ts` |
| 6 | Vault note and metadata writes could leave truncated files | Direct `writeFileSync` | Temp file and rename | `atomicWrite.test.ts` | `electron/atomicWrite.ts`, `electron/ipc/vault.ts` |
| 7 | Any URL scheme could reach the system opener | Unvalidated `shell.openExternal` | Allow `http`, `https`, `mailto` only | `externalLinks.test.ts` | `electron/externalLinks.ts`, `electron/main.ts` |
| 8 | `target="_blank"` links opened inside the app, and app windows could navigate away | No window-open or navigation handler | Links go to the browser; windows stay in the app | Same file | `electron/externalLinks.ts`, `electron/main.ts` |
| 9 | A crafted audio cache key could read or write outside the cache | Key used as a path | Validate keys | `ttsAudioCache.key.test.ts` | `electron/ipc/ttsAudioCache.ts` |
| 10 | `npm run ios:test` failed before running a test | Device chosen by name, shared build folder, Cordova undeclared | Choose by id, own folder, declare product | Now runs: 5 tests pass | `scripts/ios/test.sh`, `ios/App/BereanNative/Package.swift` |
| 11 | One Swift SQLite test asserted the wrong thing | Expected integer from a `REAL` column | Assert what matters: `n = 2` still matches | Same test | `SQLiteConnectionTests.swift` |
| 12 | `build:mas` failed in worktrees | Profiles missing | `setup:worktree` copies them | Build passes | `scripts/setup-worktree.sh` |
| 13 | `chokidar` was used without being declared | Worked only through `tailwindcss` | Declared | Clean CI install | `package.json` |
| 14 | The smoke test could fail after passing | Cleanup race on the temp profile | Tolerate it | Matrix | `scripts/smoke-electron.mjs` |
| 15 | ONNX package pin missing from the tracked resolved file | File not updated | Committed | Build | `Package.resolved` |

Items 1 to 4 were found in Stage 2. They were fixed before finishing because you ranked data loss above almost everything else.

Earlier the same day, before Stage 1: the Electron bundle repair, named verses leading, and others in `docs/ai-upgrade/JOURNAL.md`.

### Remaining

| Bug | Severity | Why it wasn't fixed | Reference |
|---|---|---|---|
| Sync D5: stale file with newer mtime overwrites a later edit | Medium, inferred | Needs a design decision on vault trust | 05 |
| Sync D6: study profiles and saved research sync only at next launch | Low | Needs invalidation design | 05 |
| Sync D7: no account check on Mac | Medium | Changes host behaviour; needs testing on real iCloud | 05 |
| Migration runner doesn't refuse a newer database, and continues if the pre-migration backup fails | Medium | Changing startup failure behaviour needs a decision | 04 §1 |
| `sandbox:false` on all windows, `webviewTag` with no `will-attach-webview`, no IPC sender validation | Medium | Each needs testing against features that depend on them | 17 |
| Permission handler ignores origin and is absent on some partitions | Medium | Same | 17 |
| Google YouTube API key ships in bundles | Medium | Needs a key-restriction or proxy decision | 17 |
| `docs/privacy.md` says no location data, but sunrise times use location | Medium | Published legal text: your wording | 17, 15 |
| eSpeak NG (GPLv3+) likely ships inside `phonemizer` | High, legal | Needs legal review | 09, 15 |
| `Yeshua` respelling probably doesn't produce the intended sound | Low | Needs your ear | 09 |
| PDF canvases never released | Low | Measured concern, needs profiling | 10 |
| Hermas text data bug (`scripts/DATA_BUG_long_verse_rows.md`) | Low | Scripture data is not altered without your review | Repo |
| `tests/integration/vault-sync.test.ts` asserts nothing | Low | Needs a real vault test harness | 11 |
| 3 high `npm audit` findings, through `sharp` from `kokoro-js` | Medium | Fix is a breaking change to speech | Section 6 |

The app isn't bug-free. The list above is what this audit found, not everything that exists.

## 5. Build and test results on `d97fb05`

Commands ran sequentially from a clean worktree of this commit.

| Check | Command | Result |
|---|---|---|
| Lockfile | `npm ci --dry-run --ignore-scripts` | Pass |
| Dependency tree | `npm ls --depth=0` | Pass |
| TypeScript | `npm run typecheck` | Pass |
| ESLint | `npm run lint` | Pass, starter rules only |
| Unit and integration | `npx vitest run` | Pass: 389 files, 5,766 tests |
| Desktop build | `npm run build` | Pass |
| Electron launch | `npm run smoke:electron` | Pass |
| Native modules | `npm run native:build` | Pass |
| Direct download | `electron-builder --mac dmg zip` | Pass: 395 MB DMG, unsigned here |
| MAS dev | `npm run build:mas:dev` | Pass, `verify-mas` OK |
| MAS production | `npm run build:mas` | Pass, `verify-mas` OK |
| MAS installer | `npm run build:mas:pkg` | Pass, 393 MB. Signed with a development certificate here |
| Packaged launch | Sandboxed Berean Dev | Pass: one window |
| iOS sync | `ios:sync:dev`, `ios:sync` | Pass |
| iOS dev safety | `ios:check:dev` | Pass |
| iOS simulator | `ios:build` | Pass |
| iOS Swift tests | `ios:test` | Pass: 5 tests |
| iOS device compile | `xcodebuild … CODE_SIGNING_ALLOWED=NO` | Pass, unsigned |
| iOS archive compile | `xcodebuild … archive CODE_SIGNING_ALLOWED=NO` | Pass, unsigned |
| Production audit | `npm run audit:prod` | Pass after production sync |
| GitHub Actions | CI on every PR and `main` | Pass on each PR. See 16 for the final run |

A step that fails `npm run audit:prod` after `ios:sync:dev` is correct behaviour: it means the iOS identity is development.

**What these results mean.** Compilation and packaging were verified. Automated tests passed. Launch was verified on Mac. Functional checks ran through the real Mac app and simulator earlier today, on the code before PRs 8 to 11.

**Blocked or not run:**

| Item | Why |
|---|---|
| Physical iPhone | Needs your device |
| Signed device install and iOS archive signing | Deliberately unsigned, to avoid changing developer portal state |
| Notarization | Would submit to Apple |
| App Store or TestFlight upload | Not authorised |
| Auto-update end to end | Needs a published release |
| Real iCloud between devices | Not exercised, to protect real data |
| Windows build | Not attempted on this Mac |
| Production-identity app launch | Would open your real data |

## 6. Dependencies and hygiene

- Removed: `clsx`, `@electron-toolkit/preload`, `@lezer/highlight`, each with no imports. Five dead `scripts/bg-test*.js`.
- Applied `npm audit fix`, including `electron-updater` and `js-yaml` advisories. Local `node_modules` in the main checkout wasn't updated, because the app was running from it, so CI's clean install is what verified these. Run `npm install` in `/Users/roywe/Berean`.
- Remaining: 3 high findings through `sharp`, reached by `kokoro-js`. `npm audit fix --force` would make a breaking change, so it wasn't run. Whether `sharp` ships in the packaged app is unverified (14).
- Not upgraded: about 50 outdated packages were left alone, including Electron 32. Blind upgrades were excluded by the brief.
- Removed from Git and kept in the backup folder: `data/kjva.db.bak-2esdras7-restore-20260805-083737`, and two `scratch/*.db.bak-clement-fix-*`. They stay in Git history.
- `.gitignore` now covers `*.db.bak*`, `scratch/` and `ios/App/DerivedData*/`.
- `NEXT_STEPS.md` moved to `docs/archive/`. `CLAUDE.md` and `docs/native-mac-checklist.md` corrected.

## 7. Branches and worktrees

Remote: only `main` remains. Local dispositions:

| Item | Disposition | Reason |
|---|---|---|
| `feature/ai-upgrade`, `feature/chat-rename`, `feature/quick-open-tabs` and their worktrees | Retained | Dirty checkouts, work is on `main`. Removing them discards local copies, which needs your approval |
| `integration/ai-upgrade`, worktree `Berean-ai-integrate` | Retained | Holds benchmark outputs (also archived) |
| `eval/ai-benchmark`, worktree `Berean-ai-bench` | Retained | Original benchmark artifacts |
| `feature/octarine-vault-integration` | Retained, decision needed | 2 commits not patch-equal to `main`, from June |
| `worktree-agent-a0acb949f0128b5e6` | Retained | Patch-equivalent, but `git branch -d` refuses it |
| `refs/recovery/2026-11-04/*`, stashes | Retained | Never removed |

## 8. Release blockers

Nothing is being released, but before the next one:

1. eSpeak licence review.
2. `docs/privacy.md` location wording.
3. Physical iPhone checks of 0.8.2 work.
4. Schema v49 reaches both platforms together: production is v48, and a v48 device stops pulling from a v49 peer until updated.
5. MAS needs a distribution-signed installer. The certificate found here signs as development.

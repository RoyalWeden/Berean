# Berean iPhone — Testing Strategy & Status

Requirements: R130–R137. Nothing in `requirements.md` is COMPLETE without the relevant rows here
being green.

---

## 1. Categories

| Category | How it runs | Where | Gate for |
|---|---|---|---|
| **UNIT** | `npx vitest run` (jsdom) | `src/**/__tests__`, `electron/**/__tests__`, `tests/unit` | every phase |
| **INTEGRATION** | `npx vitest run` — services over the in-memory adapter; two-device sync engine over a temp folder; vault sync (existing) | `src/platform/**/__tests__/*.integration.test.ts`, `tests/integration` | Phases 1, 3, 5–9 |
| **DESKTOP** | `npm run typecheck && npx vitest run && npm run build` (electron-vite build of main/preload/renderer) | CI-style script `scripts/check-desktop.sh` | every phase |
| **IOS SIMULATOR** | `npm run ios:build` (`xcodebuild -workspace ios/App/App.xcworkspace -scheme App -destination 'generic/platform=iOS Simulator'`) + `npm run ios:run` (boot simulator, install, launch) + in-app self-test screen | `scripts/ios-build.sh` | Phases 2–19 |
| **PHYSICAL IPHONE** | Xcode → Run on device; in-app self-test screen (contract tests against the real SQLite plugin); manual acceptance checklist | `ios-build.md` §Device | Phases 4, 11–19, 21 |
| **ICLOUD MULTI-DEVICE** | Mac (Electron dev build) + iPhone, both signed into the same iCloud account; R065 matrix | `testing.md` §5 | Phases 7–9, 21 |
| **PERFORMANCE** | `window.__bereanPerf` marks (cold/warm launch, first chapter, search, Strong's, tab switch, session switch, sheet open) logged to the self-test screen; Xcode Instruments for memory | §6 | Phases 11, 19 |
| **ACCESSIBILITY** | vitest role/label assertions on mobile primitives; Xcode Accessibility Inspector audit; manual VoiceOver pass | §7 | Phase 19 |
| **MANUAL ACCEPTANCE** | Checklist per feature area, executed on device by the developer with results recorded here | §8 | Phase 21–22 |

Simulator testing never substitutes for device testing for gestures, iCloud, audio session,
Share Sheet, App Intents or performance.

## 2. Desktop regression baseline (Phase 0, 2026-09-20)

```
npm run typecheck   → 0 errors (both tsconfigs)
npx vitest run      → Test Files 141 passed (141), Tests 3894 passed (3894), 14.5 s
```

Every phase gate re-runs these and records the numbers in `implementation-progress.md`.

| Checkpoint | typecheck | vitest | desktop build | iOS |
|---|---|---|---|---|
| Phase 0 (2026-09-20) | clean | 141 files / 3894 | — | — |
| Phase 1/3 + 2 gates (2026-09-21) | clean | 161 files / 4058 | OK | simulator BUILD SUCCEEDED; self-test 12/12 |

## 3. Test inventory to be added (by phase)

| Phase | Tests |
|---|---|
| 1 | `services/__tests__/*.contract.test.ts` — one file per service, every public method, over the memory adapter; `betterSqliteAdapter.test.ts` (transaction mutex, savepoints, error → rollback); `bereanMigrations.test.ts` (fresh, v42→latest, per-migration idempotence); `ipcParity.test.ts` — every preload channel still has a handler with the same name |
| 2 | `platform/__tests__/capabilities.test.ts`; `scripts/ios-build.sh` succeeds for simulator |
| 3 | `capacitorSqliteAdapter.test.ts` (plugin protocol encoding); XCTest `BereanSQLiteTests` (readonly open, FTS5 MATCH, ATTACH, batch transaction rollback, param binding incl. blobs) |
| 4 | in-app self-test: chapter/verse/FTS/Strong's/crossrefs parity against a JSON fixture exported from desktop (`scripts/export-parity-fixture.js`) |
| 5 | `sessionsService`/`tabsService` contract tests; `legacyImport.test.ts` (localStorage → tables); store hydration tests (existing `store/__tests__` remain green) |
| 6 | `hlc.test.ts`, `fractional.test.ts`, `journal.test.ts`, `merge.test.ts` (conflict matrix), `engine.integration.test.ts` (two devices) |
| 7–9 | per-entity merge tests; XCTest `BereanCloudTests` |
| 10 | `Sheet.test.tsx` (detents, drag thresholds, keyboard inset), `NavigationStack.test.tsx` (push/pop/edge-swipe), `TabPill.test.tsx` |
| 11 | `chapterPager.test.ts` (direction, boundaries, cancel), `pinchFont.test.ts` (clamp, step, no-scroll interference) |
| 12 | `verseActions.test.tsx` (menu contents per context), highlight/tag/copy sheets |
| 13 | PM touch tests (`touchSelection`, `keyboardToolbar`, `noteRefLongPress`) |
| 14 | search page tests; performance mark assertions |
| 15 | tab grid/session switcher tests |
| 16 | TTS spike report; audio session XCTest |
| 17 | `BereanWebView` XCTest; overlay geometry tests |
| 18 | deep-link parser tests (`berean://…`, shared text with refs, universal link), Spotlight index builder tests, intent → route tests |
| 19 | a11y assertions on every mobile primitive; reduced-motion tests |

## 4. Scenario tests (sync) — required rows of the conflict matrix

| # | Scenario | Expected |
|---|---|---|
| S1 | Mac creates note offline; iPhone creates different note offline; both online | both notes on both devices, no duplicates |
| S2 | Both edit the same note offline | later HLC is current; other stored as conflict version on both; badge shown |
| S3 | Mac deletes (trash) note; iPhone edits it later | note restored with iPhone edit (edit HLC > trash HLC) |
| S4 | Mac purges note; iPhone edits earlier | purge wins |
| S5 | Highlight: same verse, different colours | later wins; earlier not duplicated |
| S6 | Tag: rename on Mac, add member on iPhone | both applied |
| S7 | Session A: Mac {T1,T2}, iPhone {T1,T3} | {T1,T2,T3} |
| S8 | Tab reorder on both | deterministic order, all tabs present |
| S9 | Tab moved to session B on Mac; session B deleted on iPhone earlier | tab survives in B (resurrected session) or lands in default — rule: move HLC > delete HLC → B is resurrected |
| S10 | Workspace renamed on both | later name |
| S11 | New device restore from 5,000 notes / 20,000 highlights | completes; app usable meanwhile |
| S12 | Journal file missing mid-sequence | reader waits, requests download, resumes; no partial apply |
| S13 | iCloud signed out | outbox accumulates; status shown; flush on sign-in |
| S14 | Kill app mid-write | manifest atomic; partial journal line ignored |
| S15 | Repeated sync (100 cycles) | idempotent; no growth beyond journal size |

## 5. iCloud multi-device results (R065)

| Test | Date | Mac build | iPhone build | Result | Notes |
|---|---|---|---|---|---|
| Mac → iPhone | — | — | — | — | — |
| iPhone → Mac | — | — | — | — | — |
| offline Mac → online | — | — | — | — | — |
| offline iPhone → online | — | — | — | — | — |
| both offline, divergent | — | — | — | — | — |
| simultaneous note edit | — | — | — | — | — |
| deletions | — | — | — | — | — |
| duplicate prevention | — | — | — | — | — |
| new device restore | — | — | — | — | — |
| reinstall | — | — | — | — | — |
| DB migration across versions | — | — | — | — | — |
| large dataset | — | — | — | — | — |
| repeated sync | — | — | — | — | — |
| iCloud unavailable | — | — | — | — | — |
| interrupted sync | — | — | — | — | — |

## 6. Performance targets (set after baseline in Phase 11)

| Metric | Baseline (device, date) | Target | Latest |
|---|---|---|---|
| Cold launch → first chapter painted | — | — | — |
| (simulator, iPhone 17 Pro, 2026-09-21 — not a device number) Genesis 1 query | 4 ms | | |
| (simulator) FTS5 "love" whole KJVA | 36 ms | | |
| (simulator) Strong's H7225 entry + occurrences | 107 ms | | |
| (simulator) GEN 1:1 cross refs + TSKe | 130 ms | | |
| Warm launch | — | — | — |
| Chapter navigation (swipe commit → painted) | — | — | — |
| FTS search "love" whole library | — | — | — |
| Strong's sheet open (tap → gloss) | — | — | — |
| Tab switch | — | — | — |
| Session switch | — | — | — |
| Note open (10 KB) / keystroke latency | — | — | — |
| Sheet animation frame time | — | — | — |
| Memory after 10 min reading / after search | — | — | — |

## 7. Accessibility checklist

VoiceOver: every control labelled; verse rows read as "verse N, text"; sheets announce; tab pill
announces current tab and count. Dynamic Type: reader font scale follows the system multiplier
unless the user pins a size. Contrast: theme tokens checked at 4.5:1 for body text. Reduced
motion: sheet/page transitions become fades. Touch targets ≥ 44×44 pt. Results recorded in Phase 19.

## 8. Manual acceptance checklist (device)

Filled in Phase 21 per feature area from `feature-matrix.md`.

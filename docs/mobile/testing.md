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

## 6. Performance targets and baselines (R110 / R111)

Targets (from the brief, measured on a physical iPhone in Phase 21): cold launch → first chapter
< 1.5 s, warm launch < 0.5 s, chapter navigation commit → painted < 100 ms, library search
< 300 ms, Strong's sheet < 150 ms, tab/session switch < 100 ms, keystroke latency < 16 ms,
sheet animation 60 fps, memory < 300 MB after 10 min reading. No optimisation was done ahead of
measurement (R111); the numbers below are the simulator baseline that instrumentation now
reports on every launch (`[perf]` console lines from `src/platform/ios/perf.ts`;
`[perf] search …` from `SearchPage`).

| Metric | Simulator baseline (iPhone 17 Pro sim on an M5 MacBook Air, 2026-09-21 — not a device number) | Device (Phase 21) |
|---|---|---|
| JS boot → services ready (DB open + migrations check) | +104–108 ms after navigation start | — |
| JS boot → shell render | +105–108 ms | — |
| JS boot → first chapter (books loaded, reader mounted) | +137–176 ms | — |
| Genesis 1 chapter query | 4 ms | — |
| FTS5 "love", all texts (1,119 hits) | 122 ms | — |
| FTS5 "in the beginning", all texts (201 hits) | 62 ms | — |
| FTS5 "love", KJVA only | 36 ms | — |
| Strong's H7225 entry + occurrences | 107 ms | — |
| GEN 1:1 cross refs + TSKe | 130 ms | — |
| Native process launch → WebView navigation start | not captured by the JS marks (needs `os_signpost` on device) | — |
| Warm launch, chapter swipe, tab/session switch, keystroke latency, sheet frame time, memory | — (device) | — |

## 7. Accessibility checklist (R082) — Phase 19 pass, 2026-09-21

| Item | Status | Where |
|---|---|---|
| Every icon-only control labelled | ✔ (audit: every `<button>` in `src/mobile` has text or `aria-label`; `IconTap` requires `label`) | `primitives/Page.tsx`, sheets, bars |
| Sheets: `role="dialog"`, explicit Close button (not only backdrop/drag), newest on top | ✔ | `primitives/Sheet.tsx` |
| Space bar as `nav` with `aria-current="page"`; tab grid cards `aria-current`; segmented controls `role="radiogroup"` | ✔ | `tabs/SpaceBar.tsx`, `TabGrid.tsx`, `settings/SettingsControls.tsx` |
| Verse rows: number + text readable; long-press sheet opens with the reference as its title | ✔ (shared `VerseRow`) | `study/VerseActionSheet.tsx` |
| Dynamic Type | ✔ `BereanA11y` reports the content-size category → `--m-type-scale` multiplies every phone CSS font size (reader text stays under the user's pinch size, as the desktop zoom does) | `BereanA11yPlugin.swift`, `MobileApp.useAppearance` |
| VoiceOver / Bold Text / Increase Contrast switches | ✔ exposed as `data-voiceover`, `data-bold-text`, `data-contrast` on `<html>`; contrast rules also via `prefers-contrast: more` | `mobile.css` |
| Reduced motion | ✔ `MotionConfig reducedMotion="user"` + `prefers-reduced-motion` CSS (transitions off) | `platform/ios/main.tsx`, `mobile.css` |
| Touch targets ≥ 44 pt | ✔ rows 52 pt, icon taps 44 pt, chips ≥ 36 pt tall inside 44 pt rows; grid cells 44 pt | `mobile.css` |
| Contrast 4.5:1 body text | ✔ inherited from the design-system tokens (checked in docs/design-system.md) | — |
| VoiceOver run-through on a device (focus order, rotor, sheet announcements) | pending Phase 21 | — |

## 8. Manual acceptance checklist (device)

Filled in Phase 21 per feature area from `feature-matrix.md`.

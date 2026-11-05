# 15 - Open Questions and Decisions

> **Baseline note.** Investigated at `807c2d9`. The final baseline is `d97fb05`. The only code changes between them are PRs #9, #10 and #11, listed in `01-REPOSITORY-STABILIZATION.md`: fixes for sync defects D1-D4, note table-cell formatting, and audio cache keys. Anything below describing those defects as present is corrected where noted.

Audit snapshot, 2026-11-05. Four separate sections, as requested: (A) questions answerable by more code investigation, (B) questions that need testing or prototyping, (C) decisions that need the product owner, (D) external constraints. Each item states what is needed, what it blocks, who decides, and a suggested default only where the audit supports one. "No default" means the audit does not support one and none is invented.

Sources are cited as doc and section. Risk IDs refer to doc 12. Nothing here authorises work; doc 11 section 10 says every stage exit is a decision for the owner.

PR 9 (sync defects D1-D4), PR 10 (table-cell flattening) and PR 11 (audio cache path traversal) are treated as fixed; items touching them say so.

---

## A. Questions answerable through more code investigation

No device, account, audio or third-party answer is needed for these; the answer is in this repository or its history.

**A-1. Which `localStorage` fields exist only in localStorage?**
- *Needed:* a field-by-field table of `berean-app-state` and every `berean*` key against the `settings` table and `settingsBridge` (04 section 6.1; open item in 04 section 14).
- *Blocks:* the localStorage extraction design and the first-run importer (R-16). Doc 04 says this table must exist before an importer is written.
- *Who decides:* engineering; the owner reviews the priority order in 04 section 11.4.
- *Default:* none needed; the priority order (content, user-authored settings, preferences, UI state) is already in 04 section 11.4.

**A-2. Which user data is absent from the vault sidecars?**
- *Needed:* confirm whether Study Trail, verse tags and AI chats are written by `runExportAll`, and which `importVaultFile` fields drop (`status`, `idiom_*`) (04 section 6.5).
- *Blocks:* the claim that the vault is a last-resort recovery source (R-01).
- *Who decides:* engineering.
- *Default:* treat them as absent until checked (04 section 6.5).

**A-3. Where is the `Cmd+Shift+M` handler, and what should `Cmd+L` do today?**
- *Needed:* locate the handler (not found in `App.tsx`, 06 section 8.3, UNVERIFIED); reconcile the `Cmd+L` menu label "Go to Reference" with the renderer opening floating search in current-tab mode (`App.tsx:842-846`; `docs/ux-principles.md` section 2).
- *Blocks:* the native command table (R-44).
- *Who decides:* engineering finds it; the owner picks the behaviour (C-5).
- *Default:* the code-derived table in 06 section 8.3 supersedes CLAUDE.md.

**A-4. How many synced entity kinds are there?**
- *Needed:* reconcile 24 kinds (05 section 3, from `createEntityRegistry`) with 22 (14 section 4), and confirm the intended set including `study_profile` and `ai_saved_context` (D6: in the registry, not in `SYNCED_ENTITY_KINDS`).
- *Blocks:* the Swift entity registry and golden corpus (R-02, R-10).
- *Who decides:* engineering.
- *Default:* `createEntityRegistry` is authoritative (05 section 3).

**A-5. Which write paths bypass `data:changed`?**
- *Needed:* a complete grep of raw writes beside `vault.ts:817` and `:905`, trash expiry (`purgeExpiredTrash`, `vault.ts:1421`) and any native bridge write (05 D4, S24, section 10).
- *Blocks:* the capture contract for native writes (R-04). D4 is fixed by PR 9 for the known paths; this asks whether others exist.
- *Who decides:* engineering.
- *Default:* none.

**A-6. Can a user reach the values in `sync_conflicts`?**
- *Needed:* trace the UI for the 26 production rows (05 section 6: "not checked whether a user can reach their values").
- *Blocks:* deciding whether native needs a conflict-recovery surface (R-10).
- *Who decides:* engineering finds out; the owner decides scope.
- *Default:* none.

**A-7. What are the consequences of the INFERRED sync behaviours?**
- *Needed:* confirm by harness or code reading: the 64-entry lineage limit producing spurious conflicts (05 section 6); a large trash purge triggering the quarantine (05 section 10); the gap skipped while `sync_failed` is non-empty (`engine.ts:957`, 05 section 7). D5-D7 are not in PR 9.
- *Blocks:* the Swift port's behaviour specification (R-10).
- *Who decides:* engineering.
- *Default:* none.

**A-8. Is the Windows build released and used?**
- *Needed:* check release assets, `latest.yml` publication and `release.yml` history for evidence of shipped Windows installers (02 section 20; 17 section 11.2 item 5). Download counts are external (D-7).
- *Blocks:* C-1 (R-18).
- *Who decides:* engineering finds; owner decides in C-1.
- *Default:* none; the repo-side facts are that CI builds an unsigned NSIS x64 installer and CLAUDE.md says Windows is deferred.

**A-9. Do `onnxruntime-node` and `sharp` ship in the packaged Mac app?**
- *Needed:* inspect packaging config and, if allowed, the built app (02 section 20; 10 R6).
- *Blocks:* an accurate dependency and licence inventory (D-1, D-8).
- *Who decides:* engineering.
- *Default:* none.

**A-10. Is `feature/quick-open-tabs` merged at the audit commit?**
- *Needed:* check the `reuse` intent state (07 I7, UNVERIFIED).
- *Blocks:* the iPhone navigation contract used as the behaviour spec.
- *Who decides:* engineering.
- *Default:* use the contract docs but mark the item.

**A-11. Does `parseRef.ts` use regex features Swift `Regex` cannot match?**
- *Needed:* a regex feature inventory of `parseRef.ts` and other pure modules (08 S1).
- *Blocks:* the reference-parsing port.
- *Who decides:* engineering.
- *Default:* golden corpus from the TS implementation decides parity (08 section 11).

**A-12. Reconcile the doc 08 and doc 04 statements on downgrade.**
- *Needed:* doc 08 S3 asks whether `runMigrations` refuses a higher version; doc 04 M2 and doc 17 S-17 answer from code that it does not. Close S3 accordingly.
- *Blocks:* the independent-release rule (R-06).
- *Who decides:* engineering.
- *Default:* no refusal exists; treat as open defect.

---

## B. Questions requiring testing or prototyping

Time-boxed spikes in the audit's own terms; none is authorised by this document. Most need a device, an account, real data or audio.

**B-1. Does a TextKit 2 `NSTextView` hold 60 fps on Psalm 119 and a two-chapter scroll with 500 highlights?**
- *Needed:* Instruments run on real chapters with synthetic highlights (06 M1).
- *Blocks:* the reader architecture decision and the framework split (R-22).
- *Who decides:* the owner decides after results.
- *Default:* none; if it fails, Option B in 09 section 2.5 is the fallback.

**B-2. Can `DisplayMap` reproduce every stored highlight position?**
- *Needed:* export all highlight rows, render through both engines, diff (06 M2, BLOCKED: databases not opened here).
- *Blocks:* any native release that writes highlights (R-21).
- *Who decides:* engineering; gate in 06 section 9.2.
- *Default:* the gate stands.

**B-3. Does `NSTextTable` work under TextKit 2 on iOS 27 and macOS 27, and is TextKit 2 stable with custom fragments on long notes?**
- *Needed:* spikes E4-E6 (09 section 4).
- *Blocks:* Option A versus B for the notes editor (R-19, R-22).
- *Who decides:* owner, on engineering evidence.
- *Default:* Option A with threads and callouts flattened, and tables and columns as islands, is the "most defensible direction for investigation" in 09 section 2.5.

**B-4. Can a Swift Markdown engine match the TypeScript bytes over the real note corpus?**
- *Needed:* the real note corpus (BLOCKED, 11 G12), 29-30 round-trip cases, fuzz, threads, columns, trail embeds, trailing-space case (09 section 2.3). Regenerate goldens after PR 10.
- *Blocks:* every editor option (R-19).
- *Who decides:* engineering; acceptance is mechanical.
- *Default:* byte-for-byte equality.

**B-5. Do Swift hashes equal TypeScript hashes?**
- *Needed:* a golden corpus for `hashFields`, `fieldHashes`, ops and merge outcomes (05 section 16; 11 G1, G2).
- *Blocks:* any native sync write (R-02).
- *Who decides:* engineering.
- *Default:* 100% parity or stop (04 section 11.6).

**B-6. Real-time factor, memory and thermals for Kokoro on a physical iPhone.**
- *Needed:* device runs R3-R5 (09 section 4), including the oldest supported device.
- *Blocks:* whether the CPU baseline is viable and whether Berean Voices needs a device floor (R-25, R-26).
- *Who decides:* owner (C-17).
- *Default:* ORT CPU or Core ML `.cpuOnly` is the safe baseline (09 section 3.5).

**B-7. Does the Neural Engine run under the `audio` background mode on iOS 27?**
- *Needed:* test R7 (09 section 4); entitlement approval question is in D-3.
- *Blocks:* whether ANE can be used for locked-screen reading (R-25).
- *Who decides:* engineering.
- *Default:* assume not usable; CPU baseline with deep prefetch (09 section 3.6).

**B-8. How do non-eSpeak G2P options sound, and how does Yeshua sound today?**
- *Needed:* blind A/B listening by Michael; no audio has been generated by the audit (09 section 3.3, 3.4).
- *Blocks:* C-9 and the G2P choice (R-23).
- *Who decides:* the owner by ear.
- *Default:* none; this is subjective.

**B-9. Does Developer ID support the iCloud Documents entitlement for a native DMG app?**
- *Needed:* a signed prototype (04 section 11.2, UNVERIFIED; "must be answered before choosing a route").
- *Blocks:* C-3 and the DMG route (R-13, R-28).
- *Who decides:* engineering finds; Apple constraint in D-2.
- *Default:* none. The Electron DMG works today by path with no entitlement (04 section 11.2).

**B-10. Can a native app read Electron's `safeStorage` Keychain item?**
- *Needed:* a signed prototype under the same team (04 section 14).
- *Blocks:* whether provider keys migrate or must be re-entered (R-17).
- *Who decides:* engineering.
- *Default:* plan for re-entry (04 section 6.3).

**B-11. Can a hidden `WKWebView` at `capacitor://localhost` dump the old localStorage?**
- *Needed:* a test on a device that has not run a bridge release (04 section 11.4, INFERRED).
- *Blocks:* coverage for users who skip the bridge release (R-16).
- *Who decides:* engineering.
- *Default:* bridge release that writes a JSON file at every launch is preferred (04 section 11.4).

**B-12. Will the final Electron release accept a native app's signed zip through `electron-updater`?**
- *Needed:* an end-to-end update test on a clean DMG install; also assert notarization (04 section 11.2; 17 S-15).
- *Blocks:* the Mac DMG update route (R-15).
- *Who decides:* engineering; the route is C-15.
- *Default:* none.

**B-13. Do Migration Assistant and backup restores preserve file birthtime?**
- *Needed:* a restore test (04 section 14; 05 S22, UNVERIFIED). Fork detection depends on it.
- *Blocks:* the device-id policy for restored devices (R-05).
- *Who decides:* engineering.
- *Default:* force a fork for any copied DMG database (05 section 15).

**B-14. Does programmatic PiP and Google sign-in work in a macOS `WKWebView`?**
- *Needed:* a prototype with a test account (06 M6).
- *Blocks:* the YouTube parity claim (R-31).
- *Who decides:* owner on the result.
- *Default:* none; keep the web island either way (C-6).

**B-15. What are the iOS system SQLite version and FTS5 options on the deployment minimum, and GRDB's FTS5 requirements?**
- *Needed:* a device check (04 section 4, section 14).
- *Blocks:* the persistence engine choice and the minimum OS (R-40, R-36).
- *Who decides:* engineering.
- *Default:* GRDB recommended (08 section 7).

**B-16. Is the iPhone account-token hash stable across relaunch and OS update?**
- *Needed:* real-hardware test (05 section 8, UNVERIFIED).
- *Blocks:* trusting `hold: account` in native (R-11).
- *Who decides:* engineering.
- *Default:* an unstable value raises safe but disruptive false holds (05 section 8).

**B-17. How does real iCloud behave: timing, dataless reads, snapshot download of 4,552 files?**
- *Needed:* Stage C tests in the Dev container; the snapshot cost "not measured" (05 sections 9, 11, 12; 11 G14).
- *Blocks:* sign-off of any native sync stage (R-43).
- *Who decides:* engineering.
- *Default:* Dev container only until signed off (05 section 15 phase 1).

**B-18. Do MAS security-scoped bookmarks survive the identity change?**
- *Needed:* a test under the same signed identity (04 section 6.3).
- *Blocks:* whether users must re-pick the vault folder (R-14, R-17).
- *Who decides:* engineering.
- *Default:* assume re-pick.

**B-19. Does gesture arbitration (edge-back, pager, native sheets) work on a device?**
- *Needed:* device prototype (07 I3).
- *Blocks:* the iPhone navigation model (R-22).
- *Who decides:* engineering.
- *Default:* none.

**B-20. What are the baselines on the current app?**
- *Needed:* the doc 10 section 8 suite, run many times (launch variance is large, 10 R9).
- *Blocks:* every budget in doc 11 section 8, which are relative until baselines exist.
- *Who decides:* engineering.
- *Default:* none.

**B-21. How does a real MAS install with data behave?**
- *Needed:* a machine with MAS data (BLOCKED, 04 section 14).
- *Blocks:* the MAS-to-native route (R-13).
- *Who decides:* engineering.
- *Default:* inherit the container (04 section 11.2).

---

## C. Decisions requiring product-owner approval

Michael decides. Defaults appear only where the audit supports one.

**C-1. Fate of Windows users.**
- *Needed:* a statement of whether Windows is supported, after A-8.
- *Blocks:* the future of `release.yml`'s Windows job and the GitHub Releases feed (R-18; 17 S-16 couples Mac publishing to Windows).
- *Who decides:* owner.
- *Default (audit-supported):* a Swift app has no Windows path (17 section 11.2 item 5). Any Windows users stay on the last Electron build; their paths out are the vault export and the DB file. Decouple Mac publishing from the Windows job (17 S-16). Whether to keep the feed alive is the open choice. No further default.

**C-2. Minimum OS versions.**
- *Needed:* an OS floor for iOS and macOS.
- *Blocks:* glass and text APIs, G2P and Kokoro options, editor risk (R-36).
- *Who decides:* owner, after install-base data (D-7).
- *Default:* iOS 18 / macOS 15, with glass as `if #available` wrappers (08 section 12; a judgement, not a verified fact). Raising to iOS 27 / macOS 27 removes editor risk at the cost of users (09 section 2.5).

**C-3. MAS versus direct distribution for the native Mac app.**
- *Needed:* MAS-only, Developer ID-only, or both.
- *Blocks:* data route, sandboxing, updater, iCloud access (R-13, R-14, R-15).
- *Who decides:* owner.
- *Default:* the audit does not pick. Its facts: MAS to sandboxed native is the simplest route; DMG to non-sandboxed Developer ID is the simplest for DMG users; DMG to sandboxed is the hard case (04 section 11.2). Both channels share one bundle ID. Final choice depends on B-9 and B-12. Preserving each user's current channel is what the routes assume.

**C-4. Does Ask Berean need parity on iPhone first?**
- *Needed:* the canonical behaviour per platform.
- *Blocks:* the shape of `BereanResearch`, whether the pipeline is ported or left Mac-only (R-27).
- *Who decides:* owner.
- *Default:* option 1 in 08 section 5.9: iPhone stays model-free, Mac gets the full pipeline in a Mac-only target. The audit supports it because iPhone has no model runtime today (07 section 15.1; 09 section 1.5) and a port needs 19 raw `.prepare` statements moved first (08 section 5.9). Not decided by the audit.

**C-5. Shortcut conflicts: `Cmd+H`, `Cmd+G`, `Cmd+Shift+S`.**
- *Needed:* bindings (06 section 8.3, M7).
- *Blocks:* the native command layer (R-44).
- *Who decides:* owner.
- *Default (audit proposals in 06 section 8.3):*
  - `Cmd+H`: restore system Hide (today Hide is `Cmd+Shift+H`); move History to `Cmd+Y`. Caveat in the same table: `Cmd+Y` is redo in the editor today; editor focus wins and the menu item is validated. Editor `Cmd+Shift+H` is highlight, which is resolved by restoring `Cmd+H` as Hide.
  - `Cmd+G`: open. If the system find bar is used, `Cmd+G` must be Find Next while it is active, and Strong's moves; candidates `Ctrl+Cmd+S` or `Cmd+Opt+S`, not chosen. Note `Ctrl+Cmd+S` is also the system sidebar binding proposed below, so it cannot serve both.
  - `Cmd+Shift+S`: change to system Show/Hide Sidebar, `Ctrl+Cmd+S`.
  - Also decide `Cmd+Shift+V` (Paste and Match Style collision) and `Cmd+L` (A-3). `Cmd+/` is redundant with `Cmd+K` and `Cmd+L`.

**C-6. Does YouTube stay web content?**
- *Needed:* confirmation.
- *Blocks:* stakeholder messaging and scope (R-31).
- *Who decides:* owner.
- *Default:* yes. 06 section 12: "This surface cannot be native"; chrome around it can be. Report it as a hosted web view with native chrome. Open questions on PiP and sign-in are B-14. The dev-only transcript fetch stays out of shipping binaries.

**C-7. Privacy policy location wording (`docs/privacy.md`, and `privacy.html`).**
- *Needed:* corrected text and the matching App Store privacy label before or with any identity-preserving binary (17 section 9.2).
- *Blocks:* submission under the same store record (R-29, R-28).
- *Who decides:* owner; reviewed against D-4.
- *Default (facts the audit supports):* the sentence "No location data is accessed" is false. Location When-In-Use is requested once per launch to compute local sunrise for the daily-note day boundary; the usage strings say it is processed on-device only; entitlement `personal-information.location` is declared. The same document also overstates "entirely offline" and omits iCloud sync, the iPhone app, AI/cloud flow, BibleGateway import and model downloads (17 section 9.2). The wording itself is the owner's; none is supplied here.

**C-8. Google API key in shipped bundles.**
- *Needed:* how the YouTube Data API key ships in native builds.
- *Blocks:* YouTube search and channel features (R-30).
- *Who decides:* owner.
- *Default:* none from the audit. Facts: the key is compiled into every Mac and Windows bundle from a CI secret and is recoverable from the asar; its restrictions are unknown (17 S-14); the native app must re-provision it (17 section 11.2 item 9). Checking restrictions is external (D-6).

**C-9. Yeshua pronunciation tuning.**
- *Needed:* whether the target is "yesh-uwa" and whether to preserve current output or change it.
- *Blocks:* word replacer and speech goldens (R-23).
- *Who decides:* the owner, by ear (B-8).
- *Default:* with tokens built in Swift a name can be given as phonemes directly, for example `Yeshua → jˈɛʃuːə`, bypassing the respelling `Yeshuwa`, which eSpeak renders `jˈɛshjuːwə` with `s`, `h`, `j` separate and which the source comment marks untested by ear (09 section 3.3). That is INFERRED to sound like "yes-hyoo-wuh". Decide after listening. Current-app tuning is void whenever G2P changes.

**C-10. Known lossy behaviours: reproduce or fix in native.**
- *Needed:* a written list of what native matches (table-cell formatting after PR 10, trailing spaces, hand-aligned tables, normalisation of old notes) (09 section 2.3).
- *Blocks:* the Markdown goldens (R-20, R-19).
- *Who decides:* owner.
- *Default:* match the current app after PR 10 and PR 9; regenerate goldens afterwards. Normalise only on a real edit (09 section 2.9).

**C-11. Sync engine path.**
- *Needed:* JavaScriptCore reuse or a Swift port (05 section 13).
- *Blocks:* `BereanSync` design and timeline (R-02, R-10).
- *Who decides:* owner, on engineering advice.
- *Default:* the audit calls running the existing engine in JavaScriptCore "lowest semantic risk" and a "good transitional design"; a Swift port needs golden tests. CloudKit is a separate project after all devices are native.

**C-12. Schema freeze during coexistence.**
- *Needed:* confirm additive-only and no schema growth until retirement.
- *Blocks:* independent releases (R-06).
- *Who decides:* owner.
- *Default:* yes (04 section 11.7; 05 section 15; 08 section 1 item 8). Add the too-new refusal to old builds first (17 S-17).

**C-13. Notes editor architecture and accepted limits.**
- *Needed:* Option A, B or C, and acceptance of reduced selection across table and column boundaries.
- *Blocks:* the largest single item (R-19, R-22).
- *Who decides:* owner after B-3.
- *Default:* decide after spikes; Option A is the direction to investigate (09 section 2.5).

**C-14. Vault location and the custom sync folder.**
- *Needed:* keep the Mac-only vault code in a Mac-only target; keep or retire `icloudSyncFolder` (05 section 12 item 4; 08 S11).
- *Blocks:* module layout (R-04).
- *Who decides:* owner.
- *Default:* vault in a Mac-only target (listed as a decision, 08 S11). Custom sync folder: keep it or migrate away deliberately; no default.

**C-15. Mac updater: Sparkle or MAS-only.**
- *Needed:* the update mechanism for a non-MAS native app (08 S7; 17 section 11.2 item 4).
- *Blocks:* the bridge release design (R-15).
- *Who decides:* owner.
- *Default:* none; depends on C-3 and B-12.

**C-16. Scope of standalone window and floating rail.**
- *Needed:* whether they are used (06 M10; no telemetry exists).
- *Blocks:* native scene design (R-32).
- *Who decides:* owner.
- *Default:* none.

**C-17. Device floor for Berean Voices.**
- *Needed:* whether to restrict voices on older devices (09 section 3.5: "may force a device floor").
- *Blocks:* R-26.
- *Who decides:* owner after B-6.
- *Default:* none.

---

## D. External constraints

Things outside the repository and outside the owner's sole control.

**D-1. eSpeak NG legal review.**
- *Needed:* counsel's opinion on shipping a package that embeds eSpeak NG (GPL v3 or later) behind an Apache-2.0 npm label, in the Electron Mac app, MAS build and iPhone App Store build today, and on any data derived from eSpeak dictionaries (09 section 3.4).
- *Blocks:* the Read Aloud G2P choice and arguably current distribution of Read Aloud (R-24, R-23).
- *Who decides:* the owner takes counsel's advice. The audit makes no legal determination; the exposure is INFERRED.
- *Default:* do not link eSpeak into a Swift app (09 table: not acceptable for App Store distribution, INFERRED); prefer a lexicon built from permissive sources.

**D-2. Apple: Developer ID and the iCloud Documents entitlement.**
- *Needed:* whether a Developer ID app may hold it today (04 section 11.2, UNVERIFIED).
- *Blocks:* B-9, C-3.
- *Who decides:* Apple.
- *Default:* none.

**D-3. Apple: Background Inference entitlement.**
- *Needed:* whether `com.apple.developer.background-tasks.continued-processing.inference` needs approval and how it works with audio (09 section 3.5).
- *Blocks:* ANE use for locked-screen reading (R-25).
- *Who decides:* Apple.
- *Default:* assume CPU baseline.

**D-4. App Review.**
- *Needed:* acceptance of any temporary-exception entitlement (04 section 11.2); Apple's rules on third-party AI disclosure for the Anthropic BYO-key flow (17 section 9.1); MAS iCloud profile and installer certificate state (17 section 10.2); removal of the MAS app-group entry (17 section 11.2 item 11).
- *Blocks:* R-28.
- *Who decides:* Apple; the owner decides what to submit.
- *Default:* do not rely on temporary exceptions (04 section 11.2).

**D-5. No App Store downgrade; bundle identity is fixed by Apple.**
- *Needed:* none; a constraint. Rollback means a higher-version build that can still read the database; a new bundle ID is a new store record (04 section 11.3; 17 section 11.2 item 1).
- *Blocks:* the rollback design (R-12, R-28).
- *Who decides:* Apple.
- *Default:* phased release; keep the identity (04 section 11.3).

**D-6. Google: key restrictions, embedded sign-in, YouTube terms.**
- *Needed:* the restrictions on the shipped key (17 S-14, not verified); whether Google accepts sign-in in `WKWebView` (06 section 12, UNVERIFIED); exposure of channel-page scraping, whose fragility and terms-of-service risk carry over unchanged (06 section 12).
- *Blocks:* C-8, B-14 (R-30, R-31).
- *Who decides:* Google, via the Cloud console and policy.
- *Default:* none.

**D-7. Install-base and usage data.**
- *Needed:* App Store Connect device and OS distribution, GitHub Releases update statistics, Windows download counts (08 section 12; 06 M9; 07 I1). The audit has none.
- *Blocks:* C-1, C-2.
- *Who decides:* external data sources; owner interprets.
- *Default:* none.

**D-8. Licences of models, dictionaries and ports.**
- *Needed:* full text for CMUdict (read only as "permissive per README"), misaki dictionaries, Kokoro model terms for FluidAudio, and the other ports' licences (09 section 3.4, 3.5).
- *Blocks:* the G2P and inference choice (R-23, R-24).
- *Who decides:* counsel and the owner.
- *Default:* none.

**D-9. Bible text licensing.**
- *Needed:* licensing of Taylor/Hoole and other translations, Strong's, TSKe and transcripts is not audited (17 section 9.2, UNVERIFIED); bundled texts are copied by size and mtime only (04 section 3).
- *Blocks:* App Store claims and the "public-domain" statement in the privacy policy.
- *Who decides:* the owner.
- *Default:* none.

**D-10. Third-party identities the new app inherits.**
- *Needed:* ownership of `berean.app` (used as Referer base `player.berean.app`, not verified), GitHub repo `RoyalWeden/Berean` (update feed, `data-v1` data release, Pages, `sitgmeat.com`), the Apple ID used for notarization, and the store listing's privacy and support URLs (17 section 11.2 item 12).
- *Blocks:* continuity of updates and data assets (R-12, R-15).
- *Who decides:* the owner.
- *Default:* keep all of them in place for the overlap period.

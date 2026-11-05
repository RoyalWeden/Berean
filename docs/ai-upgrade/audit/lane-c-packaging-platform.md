# Lane C — Packaging, sandbox, iOS, tests, design system (inferred from code, 2026-10-28)

## Packaging (package.json `build`, L123+)
- `files`: out/**/* minus ort-wasm-*.wasm (guarded by electron/__tests__/packagedAssets.test.ts). `asarUnpack: **/*.node`. `extraResources` data/*.db (excl. youtube_index.db) → Resources/data/. npmRebuild true; `rebuild` = electron-rebuild better-sqlite3.
- mac (L167): dmg+zip arm64, hardenedRuntime true, entitlements build/entitlements.mac.plist (allow-jit, allow-unsigned-executable-memory, allow-dyld-environment-variables). extraResources build/native/berean_glass.node.
- mas (L202): arm64, hardenedRuntime false, min macOS 12.0, provisioningProfile build/embedded.provisionprofile (absent in worktree). extraResources berean_icloud.node + berean_glass.node.
- entitlements.mas.plist: app-sandbox, allow-jit, allow-unsigned-executable-memory, network.client, files.user-selected.read-write, files.bookmarks.app-scope, application-identifier, team-identifier, iCloud (CloudDocuments, Production), personal-information.location, print, application-groups (Chromium Mach rendezvous). inherit plist: sandbox + inherit only (extra keys → SIGTRAP).
- scripts/mac/verify-mas.mjs L35-45 forbids: downloads.*, get-task-allow, **network.server**, allow-dyld-environment-variables, **disable-library-validation**, temporary-exception file entitlements. Helpers must be sandbox+inherit only.
- afterPack: LSMinimumSystemVersion 12.0, ITSAppUsesNonExemptEncryption=false, bundled DBs WAL→DELETE.
- Native precedent: in-house Node-API addons (scripts/mac/build-native.mjs; native/mac-icloud, native/mac-liquid-glass) built with xcrun clang, NAPI 8, shipped via extraResources → Resources/native, signed by osx-sign, loaded with process.dlopen (electron/liquidGlass.ts:45-60, electron/sync/macContainer.ts:28-31), graceful when missing. **No spawned helper executables** (only /usr/bin/brctl). ⇒ An in-process llama.cpp Node-API addon has precedent; a localhost llama-server helper conflicts with the network.server ban.
- Desktop Kokoro: kokoro-js/onnxruntime-web WASM in renderer worker; weights downloaded to userData, served via `berean-model://` (electron/ttsModelProtocol.ts); CSP adds 'wasm-unsafe-eval' (electron/csp.ts:23-28). Precedent for downloaded (not bundled) weights.
- docs/mac-app-store.md (entitlement map, iCloud helper, build/verify, Dev identity). Scripts build:mas, build:mas:pkg, build:mas:dev.

## Versions
electron 32.3.3, electron-builder 24.13.3, electron-vite 2.1, vite 5.2, vitest 1.5.3, TS 5.4.5, React 18.3, better-sqlite3 12.10, Capacitor 8.5.2, local Node 24.14. No llama.cpp / node-llama-cpp anywhere. Ollama refs: electron/ollama.ts (DEFAULT_OLLAMA_MODEL llama3.1:latest, NUM_CTX 16384), aiLookup.ts, semanticCandidates.ts, tokenBudget.ts, build-embedding-index.js. verse_embeddings.db not shipped (embeddingsDb.ts:24-30); data/*.db extraResources glob would ship it if placed there.

## iOS
- Deployment target 17.0. Targets App, ShareExtension, BereanWidget. App.entitlements: iCloud CloudDocuments, app groups. **No increased-memory-limit / extended-virtual-addressing entitlement.**
- CapApp-SPM/Package.swift is Capacitor-managed (never edit). Own plugins in ios/App/BereanNative/Package.swift (capacitor-swift-pm, onnxruntime-swift-package-manager 1.24.2 exact, sqlite3, XCTest target), injected by scripts/ios/patch-xcodeproj.mjs L112-127; step 12 fixes framework MinimumOSVersion (ITMS-90208). Plugins registered in BereanBridgeViewController.swift L24-37.
- BereanDownloadsPlugin: resumable URLSession + SHA-256 into AppSupport/Berean/downloads/, backup-excluded.
- scripts/ios/bundled-dbs.txt excludes verse_embeddings.db (~150 MB of DBs bundled).
- docs/mobile/decisions.md D-009 (L235-247): AI Lookup desktop-only on iPhone; "bare Ollama forwarder" rejected; port plan → src/platform/services/aiLookupService.ts.

## Tests / tooling
- `test` = vitest (watch); `typecheck` = tsc ×2; `lint` = eslint but **no eslint config** (likely broken under ESLint 9).
- vitest.config.ts jsdom; scripts/eval/vitest.eval.config.ts node env, report-only.
- ~335 test files; electron/__tests__/entitlements.test.ts guards entitlements.
- Probes: BEREAN_CDP_PORT + BEREAN_QA_USER_DATA (scripts/perf/launch.mjs); iOS probe-server.mjs with BEREAN_E2E_PROBE=1.

## Design system (docs/design-system.md)
Layers: content flat `.material-content`; chrome `.material-bar`; controls `.control-glass`; popover/sheet materials; no glass inside glass. Tokens only (no hex/Tailwind palette/text-[Npx]/raw z). Semantic: bg-surface-elevated cards, --color-separator, bg-accent-muted, text-destructive, bg-success/15. Radii chip 4 / card 8 / row 10 / menu 14 / sheet 20. Type caption 11 / footnote 12 / subhead 13 / body 14; text-meta; SectionLabel only uppercase. Rows 36 (28 dense). Primitives: CardButton (AI results), ListRow, Chip, Badge, RefChip (verse/Strong's), Sheet, SegmentedControl (≤4) / Select, ScrollContainer, EmptyState, Tooltip prop. Lucide 1.75. **No table primitive.**
iOS (docs/mobile/ios-design-system.md L27-60): --m-card-bg 16px inset cards, .mobile-sheet 30px top radius, --m-fill chips, .m-glass*, Reduce Transparency → opaque.
Mobile rules: shared code can't import electron/fs/better-sqlite3; platform boundary = window.* namespaces; core paths offline; <300 MB after 10 min reading; no analytics.

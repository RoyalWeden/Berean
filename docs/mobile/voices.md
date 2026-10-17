# Read Aloud Voices on iPhone

## The problem

On iPhone, Read Aloud used `NativeSpeechBackend` over `BereanSpeechPlugin` (iOS's own
`AVSpeechSynthesizer`), and `BereanSpeechPlugin.voices()` listed **every**
`AVSpeechSynthesisVoice.speechVoices()` on the device unfiltered — every language, every quality
tier, including Apple's old compact/"Default"-quality synthesiser voices (what reads as
"generic/system-sounding") and a long tail of novelty/Eloquence voices (Zarvox, Bubbles, Organ,
Bad News, Wobble, …) that were never meant for reading prose. `nativeSpeechBackend.ts` only
sorted English first; it did not filter anything out.

Requirement: no generic system voices visible in the picker; a small curated set of
high-quality, natural voices; free (no paid TTS/API); offline preferred; first priority is
reusing the neural voices Berean already ships — Kokoro, the Mac's TTS engine.

## Can Kokoro run in the iPhone WKWebView? (audit)

Mac's Kokoro engine (`src/lib/tts/kokoro/kokoroBackend.ts` + `kokoro.worker.ts`) is `kokoro-js`
(built on `@huggingface/transformers`/`onnxruntime-web`), running in a **Web Worker inside the
Electron renderer**, synthesizing with the `onnx-community/Kokoro-82M-v1.0-ONNX` model (q8 ≈92MB)
downloaded once into `{userData}/tts-models` and served back to the renderer/worker's `fetch()`
calls through a **custom Electron `protocol.handle` scheme** (`berean-model://`, registered via
`protocol.registerSchemesAsPrivileged` in `electron/ttsModelProtocol.ts`) — Electron's
main-process-only workaround for the fact that a renderer cannot `fetch()` a `file://` path.

Two concrete, structural blockers to reusing this as-is inside Capacitor's iOS WKWebView:

1. **Model file serving has no iOS equivalent.** `protocol.handle`/
   `registerSchemesAsPrivileged` are Electron main-process APIs; nothing in the current iOS app
   provides an analogous privileged scheme for `fetch()` to read arbitrary large binary files out
   of app storage. Building one would mean a new native `WKURLSchemeHandler`-based Capacitor
   plugin — a new native subsystem, not a small change, and outside this lane's file scope
   (`BereanSpeechPlugin.swift` only).
2. **The WASM build Kokoro actually loads needs cross-origin isolation.** `kokoro.worker.ts`
   configures `env.backends.onnx.wasm` to load `ort-wasm-simd-threaded.jsep.wasm` — the
   threaded+SIMD ONNX Runtime WASM build. Threaded WASM requires `SharedArrayBuffer`, which
   browsers (and WKWebView) only expose to a page served with `Cross-Origin-Opener-Policy` /
   `Cross-Origin-Embedder-Policy` headers (`crossOriginIsolated === true`). Capacitor's iOS
   `capacitor://localhost` static asset serving does not set these today, and doing so is itself
   a native config change outside this lane's scope. Without threads, ONNX Runtime falls back to
   a single-threaded WASM build, which is dramatically slower for an 82M-parameter model — with
   no physical device available to this lane to benchmark, but single-threaded WASM inference of
   a model this size is a well-known multi-second-per-sentence regime on mobile Safari/WKWebView,
   not viable for "press play, chapter starts reading."

Neither blocker is a matter of app code in the files this lane can touch — both require new
native iOS/Capacitor plumbing (a custom scheme handler, and/or COOP/COEP response headers for the
bundled web assets). That is a real, separate project, not a "wire it up" task.

## Decision: (b) — curated Apple voices now, Kokoro-on-iOS is future work

Implemented the curated-Apple-voices fallback (§ below) as the shipping solution, and left
Kokoro-on-iOS undone, gated on the two blockers above. Concretely, to revisit later:

- A Capacitor/native plugin that exposes a `WKURLSchemeHandler` (or equivalent) serving files out
  of app storage to `fetch()`, mirroring what `ttsModelProtocol.ts` does for Electron.
- Confirming (on a physical iPhone) whether Capacitor's iOS webview can be configured to serve
  its bundled assets with COOP/COEP so `SharedArrayBuffer`/threaded WASM is available; if not,
  benchmarking single-threaded `ort-wasm-simd.wasm` (no `-threaded`) synthesis latency for one
  Kokoro sentence chunk on-device before deciding it's viable at all.
- If both check out: download-on-demand of the q8 model (~92MB) into app storage via Capacitor
  Filesystem, a curated voice subset (af_heart, af_bella, am_michael, bm_george, bf_emma,
  am_fenrir), reusing `kokoroChunking.ts`/`timestampAlignment.ts` as-is since those have no
  Electron dependency.

## What shipped: curated Apple voices

`src/lib/tts/nativeSpeechBackend.ts` now exports `curateIosVoices(raw): TTSVoiceOption[]`, run
inside `createNativeVoiceProvider` before the picker ever sees the list:

- **English only** (`lang` starts with `en`).
- **Novelty/Eloquence names excluded outright**, regardless of reported quality: Albert, Bad
  News, Bahh, Bells, Boing, Bubbles, Cellos, Good News, Jester, Organ, Superstar, Trinoids,
  Whisper, Wobble, Zarvox, Grandma, Grandpa, Eddy, Flo, Reed, Rocko, Sandy, Shelley. Matched
  against the voice's base name with any trailing `(Enhanced)`/`(Premium)` suffix stripped, so it
  doesn't matter which form a given iOS version reports the name in.
- **Premium/Enhanced quality only** — never `.default` (compact/"generic"). Quality comes from
  `AVSpeechSynthesisVoice.quality`, which `BereanSpeechPlugin.voices()` already exposed as
  `"Premium" | "Enhanced" | "Default"` (no Swift change was needed here — the data was already
  there; only the TS-side list was unfiltered).
- **Ranked** Premium before Enhanced, then by a preferred-name list (Ava, Zoe, Evan, Nathan,
  Samantha, Daniel, Serena), then alphabetically. (Originally capped at 6 — removed 2026-10-11, see the update below.)
- **Empty-installed-voices fallback**: if the device has zero Premium/Enhanced English voices
  (a stock, never-touched iOS install), the picker shows the single best available English voice
  (any tier, novelty still excluded) plus a non-selectable explanatory row: "Download
  higher-quality voices: Settings → Accessibility → Spoken Content → Voices → English" — apps
  cannot download Apple's better voices programmatically, so this is the honest ceiling.
- If there is no English voice at all, only the hint row is shown.

This is expressed as a new optional `kind?: 'voice' | 'hint'` discriminant on the shared
`TTSVoiceOption` type (`src/lib/tts/ttsBackend.ts`) — every other backend (Kokoro) simply never
sets it, so nothing about the Mac engine changed.

### Selected-voice fallback

`AudioSettingsPage.tsx`'s existing `voices.find(v => v.voiceURI === stored) ?? voices[0]` pattern
already gives "falls back to the best curated voice if the stored selection is no longer valid"
for free, since curation runs before the picker sees the list and `voices[0]` is always the
top-ranked curated pick (or the lone fallback voice) — it was adjusted only to exclude the hint
row from that fallback (`selectableVoices = voices.filter(v => v.kind !== 'hint')`), so the hint
is never treated as "the active voice."

## Files touched

- `src/lib/tts/ttsBackend.ts` — `TTSVoiceOption.kind` discriminant.
- `src/lib/tts/nativeSpeechBackend.ts` — `curateIosVoices`, `NO_PREMIUM_VOICE_HINT`, wired into
  `createNativeVoiceProvider`.
- `src/lib/tts/__tests__/nativeSpeechBackend.test.ts` — curation unit tests + updated existing
  voice-provider test (it previously asserted the *un*curated list).
- `src/mobile/settings/AudioSettingsPage.tsx` — renders a `kind === 'hint'` row as plain
  explanatory text (no checkmark, not clickable); excludes it from the active-voice fallback.
- `BereanSpeechPlugin.swift` — **unchanged**. It already reported `identifier`/`name`/`lang`/
  `quality` for every voice; the curation work is entirely on the TS side. No Xcode build was
  run to verify this (no device/simulator available to this lane) — the file was not edited, so
  nothing new needs building.

## What must be verified on a physical iPhone

1. That a stock/never-customized iPhone actually reports zero Premium/Enhanced English voices
   (or however many it ships by default — this varies by iOS version) and that the fallback +
   hint row render correctly for that device state.
2. That the curated 6 (or fewer) voices sound as expected and that `previewVoice` plays each one
   correctly through `BereanSpeechPlugin.speak()`.
3. That selecting a voice, backgrounding/reopening the app, and re-reading the stored
   `ttsVoiceURI` still resolves to the same voice (voice identifiers are stable per-device but
   this lane could not confirm they're stable across iOS updates).
4. Whether any currently-installed Enhanced/Premium English voice on Michael's own device gets
   wrongly caught by the novelty name-match (e.g. a real voice literally named "Reed" or "Flo" if
   Apple ever reuses those as non-novelty names in a future iOS release — unlikely, but worth one
   glance at the actual list `voices()` returns on-device).

## Update 2026-10-11 — Berean Voices on the iPhone (supersedes the decision above)

Reported: "I don't see the settings thing for the voices… the download for the voice should be
inside the app." Apple's Premium voices can only be downloaded in the Settings app (no API; the
Open Settings button landed on Berean's own, voice-less Settings page), so the iPhone now uses
the Mac's voices instead — **Berean Voices** (Kokoro), downloaded with one tap inside Berean.

- **Where:** Settings → Read Aloud → Berean Voices (also the Voice list, the player's Voice view,
  and a "Get Berean's natural voices" prompt in the player until installed). One tap downloads
  ~341 MB (the Mac's files minus its WASM runtime) with progress and Cancel; Remove frees it.
- **Download:** `BereanVoicePackPlugin.swift` fetches the files one at a time from Hugging Face
  into `Application Support/Berean/tts-models/.download-tmp`, moves the folder into place and writes
  `.manifest.json` last (never a half pack that reports ready), excluded from backup. Module-level
  state (`src/platform/ios/voicePack.ts`) keeps the progress when the user leaves the screen. It
  installs `window.ttsModel` (the Mac's contract), so the store's `kokoroModelReady` →
  `activateKokoroBackend()` path is shared.
- **Synthesis:** blocker 2 above was real — WASM in the WebView ran ~5 s for 3.5 s of speech on
  the simulator. So the worker still phonemizes and tokenizes with kokoro-js (`new KokoroTTS(model,
  tokenizer)` with a stand-in model), and the model runs natively on ONNX Runtime's multi-threaded
  CPU engine (`synthesize`, SPM `onnxruntime-swift-package-manager` 1.24.2): ~1.4 s to start a
  6–7 s sentence on the simulator. Blocker 1 needed no new scheme: the worker reads the files via
  Capacitor's `_capacitor_file_` URLs (`modelBase.ts`).
- **Offline, both apps:** kokoro-js fetched each voice's style file from Hugging Face at first use
  (not from the downloaded pack). The worker now serves those requests from the pack — verified by
  emptying one voice file on the simulator: that voice failed, others played.
- **Engine switch:** download finished / voices removed while reading → the chapter carries on from
  the same verse on the new engine (it used to leave the player "playing" with no sound).
- A stored system-voice choice reads in Heart (the default Berean voice) once Berean Voices are on.
- App size: ONNX Runtime is a ~40 MB static library before dead-stripping.
- **Device-only:** real-iPhone speed and memory, reading with the screen locked (the WebView's
  JavaScript drives each sentence), and the download over cellular / when leaving the app.

## Earlier update 2026-10-11 — finding and getting better voices (superseded)

Reported: "I don't see anywhere to get the better voices." The download hint above only appeared
when the device had **zero** Premium/Enhanced English voices, and only as a row inside the Voice
list; the voice list was read once per launch (a voice downloaded in Settings did not appear until
Berean was relaunched); and the list was capped at 6, which could hide a voice just downloaded.

- **Get Better Voices** (`src/mobile/audio/GetVoicesView.tsx`) is always reachable: Settings →
  Read Aloud (row under Voice, and at the bottom of the Voice list) and the player's Voice view.
  It lists the installed Premium/Enhanced voices, gives the exact path, and has **Open Settings**.
- The path names **Read & Speak (or Spoken Content)** on iOS 26+ (both pages ship in 26.5 and 27.0 — the iOS 27 simulator shows Spoken Content), **Spoken Content**
  before. The version comes from `BereanSpeechPlugin.voices()` (`osMajor`) because the WKWebView
  user agent is frozen (it reports "iPhone OS 18_7" on iOS 27).
- Apps cannot download Apple voices or deep-link to the Voices page (only private `App-prefs:` URLs
  can, which App Review rejects), so Open Settings uses `UIApplication.openSettingsURLString`.
- The list refreshes on `AVSpeechSynthesizer.availableVoicesDidChangeNotification` (plugin event
  `voicesChanged`) and whenever Berean returns to the foreground. No cap on installed voices.
- Not verifiable in the simulator: downloading a voice (the simulator cannot download voices) and
  the live refresh after a real download — check on a physical iPhone.

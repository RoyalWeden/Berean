# Native phonemizer compatibility probe

Run from a checkout with the original npm dependencies installed:

```sh
node scripts/native/phonemizer-probe/check.mjs
# Run the same non-UI executable inside a booted Apple Silicon iPhone simulator.
node scripts/native/phonemizer-probe/check.mjs --simulator <simulator-UUID>
# Check just the Swift model inputs using the installed JavaScript phonemizer.
node scripts/native/phonemizer-probe/check.mjs --inputs-only
# Check against the original tokenizer using the three verified local JSON files.
node scripts/native/phonemizer-probe/check.mjs --inputs-only --tokenizer-dir /path/to/verified-json-files
# Research alternative: compile current upstream resources instead of preserving original data.
node scripts/native/phonemizer-probe/check.mjs --compiled-resources
```

Requires Swift 6.2/Xcode 27. The full phonemizer probe requires the pinned official
eSpeak SPM package and its submodules. The input-only check uses the installed
npm dependencies and skips SwiftPM and its eSpeak dependency. Builds and resources
live in a fresh temporary directory, removed afterward.
Default mode unpacks the exact English resource data from the installed original
`phonemizer` bundle into that directory. No resource bytes are committed here.
The native engine uses synchronous phoneme tracing, as the original wrapper does;
its callback discards internal eSpeak PCM. No audio output device is opened, no
weights or voice pack are downloaded, and no Berean library is read or changed.

The probe links native `BereanText` normalization, punctuation segmentation and IPA
cleanup, comparing both raw US/British clause arrays and complete Kokoro phonemes
to the original installed JavaScript implementations. All expanded cases remain
strict assertions; differences are collected rather than hidden by stopping at the
first mismatch. The simulator mode uses `simctl spawn`; it does not install,
launch, terminate or alter the Berean app or any physical device.

The model-input check defaults to an explicit test vocabulary with Transformers.js to
exercise Unicode-scalar token IDs, boundary padding and truncation. It compares
native inputs to the installed Kokoro class before ONNX inference. The fixture
IDs do not represent the model's production tokenizer. With `--tokenizer-dir`, the
check verifies the original ONNX model repository's three JSON files by SHA-256
and compares the actual production IDs. See the [tokenizer verification report](../../../docs/native-migration/READALOUD-TOKENIZER-2026-11-26.md)
for the pinned source revision and filenames. The option works with the full
phonemizer check and with `--inputs-only`. The check reads the
installed Kokoro npm package's Heart and Emma voice files and compares all 256
selected Float32 values bit for bit. It covers US and UK phonemes from the full
probe, plus supplied IPA, empty input, unknown scalars and token limits. The
input-only mode supplies US and UK phonemes from the installed JavaScript oracle.

Two compatibility details matter:

- Newly compiled upstream resources initially matched a smaller sample but drifted
  on `four`/`fourth`. Preserve original resources for original voice quality.
- Direct `TextToPhonemes` differs from synthesis tracing in paragraph stress.
  Tracing with discarded PCM preserves that behavior without audible eSpeak output.

The alternative resource-compilation mode is intentionally retained for research
and may fail compatibility comparisons. Its copied resources are source data, not
ready-to-load tables: compile phonemes and intonation first, initialize the base
English translator, then compile its dictionary in a separate process. Resolve
executable symlinks and use `Bundle.resourceURL` for macOS bundle resources.

This is a reproducible research checkpoint, not a Read Aloud playback backend.
Neither app links the eSpeak package. Before app integration, establish packaged
resource provenance/integrity and the migration's G2P licensing approval. Engine
verification still covers fp32 ONNX PCM, streaming, cancellation, word timing and
listening quality with the licensed assets.

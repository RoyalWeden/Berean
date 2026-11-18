# Native phonemizer compatibility probe

Run from a checkout with the original npm dependencies installed:

```sh
node scripts/native/phonemizer-probe/check.mjs
# Run the same non-UI executable inside a booted Apple Silicon iPhone simulator.
node scripts/native/phonemizer-probe/check.mjs --simulator <simulator-UUID>
# Research alternative: compile current upstream resources instead of preserving original data.
node scripts/native/phonemizer-probe/check.mjs --compiled-resources
```

Requires Swift 6.2/Xcode 27 and network access for the pinned official eSpeak SPM
package. Builds and resources live in a fresh temporary directory, removed afterward.
Default mode unpacks the exact English resource data from the installed original
`phonemizer` bundle into that directory. No resource bytes are committed here.
The native engine uses synchronous phoneme tracing, as the original wrapper does;
its callback discards internal eSpeak PCM. No audio output device is opened, no
Kokoro model/voice pack is downloaded, and no Berean library is read or changed.

The probe links native `BereanText` normalization, punctuation segmentation and IPA
cleanup, comparing both raw US/British clause arrays and complete Kokoro phonemes
to the original installed JavaScript implementations. All expanded cases remain
strict assertions; differences are collected rather than hidden by stopping at the
first mismatch. The simulator mode uses `simctl spawn`; it does not install,
launch, terminate or alter the Berean app or any physical device.

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
resource provenance/integrity and the migration's G2P licensing approval, tokenizer
IDs, fp32 ONNX/style vectors, streaming/cancellation/word timing and actual listening
quality. Phoneme agreement alone does not establish audible quality.

# Native phonemizer resource probe

Run from a checkout with the original npm dependencies installed:

```sh
node scripts/native/phonemizer-probe/check.mjs
# Optional: compile/run the probe inside a booted Apple Silicon iPhone simulator.
node scripts/native/phonemizer-probe/check.mjs --simulator <simulator-UUID>
```

Requires Swift 6.2/Xcode 27 and network access for the pinned official eSpeak SPM
package. Builds and resources live in a fresh temporary directory, removed afterward.
The executable compiles phoneme tables, intonation and the English dictionary from
the same package revision, then compares US/British raw IPA clause arrays against the original
`phonemizer` dependency. It does not synthesize sound, download Kokoro weights, read
any Berean library or link a new dependency into either application.
The simulator mode uses `simctl spawn` for this non-UI executable; it does not install,
launch, terminate or alter the Berean app or any physical device.

The package's copied resources are **source data**, not ready-to-load tables.
Loading them directly fails because `phontab` is absent. Compile phonemes and
intonation first, initialize the English voice, then compile its dictionary in a
separate process. Dictionary compilation requires the translator created by voice
initialization. Resolve the executable symlink and use `Bundle.resourceURL` to find
macOS bundle resources.

This is a reproducible research checkpoint, not the Read Aloud backend. Before app
integration, establish iOS resource packaging, dependency/license compatibility,
the original `kokoro-js` normalization/IPA postprocessing and tokenizer IDs, fp32
ONNX inference/style vectors, streaming audio cancellation and actual listening
quality. Raw phoneme agreement alone does not establish audible quality.

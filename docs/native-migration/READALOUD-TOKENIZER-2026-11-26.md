# Read Aloud production tokenizer verification

The original Electron and Capacitor downloaders select `onnx-community/Kokoro-82M-v1.0-ONNX` through `resolve/main`. The revision served for `tokenizer.json` on November 26 was `1939ad2a8e416c0acfeecc08a694d14ef25f2231`. The probe pins that snapshot. The repository declares Apache 2.0. [Pinned model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md)

Pass the directory containing these three public JSON files to `check.mjs --tokenizer-dir`. They total 3,654 bytes and were retrieved into `/private/tmp` for this check. The tokenizer’s Git blob hash also matched the server’s ETag, `4280f55fc1c32211bc9bb4d55545759a00054ecd`.

| File at the pinned revision | Bytes | SHA-256 |
| --- | ---: | --- |
| [tokenizer.json](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/tokenizer.json) | 3,497 | `77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34` |
| [tokenizer_config.json](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/tokenizer_config.json) | 113 | `be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20` |
| [config.json](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/config.json) | 44 | `df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f` |

The pinned definition deletes all scalars outside its 115-entry vocabulary before splitting into individual characters. It adds token `0` at each boundary and truncates the resulting sequence after 512 tokens. The Swift probe processes the original phoneme strings independently using the verified vocabulary. Installed Kokoro 1.2.1 and Transformers.js 3.8.1 run the original tokenizer and style selection. An input recorder captures the IDs, all 256 Float32 style values, and speed at the model boundary.

Mac and the booted arm64 iPhone Simulator each passed all 68 cases in production mode and all 68 in fixture mode. Each includes 52 inputs prepared with the installed US and UK JavaScript phonemizers and 16 supplied phoneme cases. A modified tokenizer file was rejected by SHA-256. Swift compilation, JavaScript syntax, ESLint, and the whitespace check passed. Logs are in `/private/tmp/berean-kokoro-tokenizer-43ufFJ/`.

The native IPA assertions remain in the full probe. A fresh full run stopped at SwiftPM’s manifest sandbox. The offline retry reached dependency resolution and lacked the eSpeak package in its local cache. The new input comparisons use the installed JavaScript phonemizer.

The apps still need approved G2P licensing and resource packaging, fp32 ONNX/24 kHz PCM verification, streaming, cancellation, word timing, and listening checks before Read Aloud can ship.

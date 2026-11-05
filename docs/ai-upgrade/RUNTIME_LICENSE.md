# Local runtime and model licensing — Phase 4 groundwork (2026-10-28)

Research only. Nothing is installed or downloaded. Not legal advice; Michael confirms licenses before any model ships.

## License matrix (candidate weights)

| Model | License (source checked) | Redistribution conditions | Status |
|---|---|---|---|
| qwen3.5 2B / 4B / 9B | Apache-2.0 — Hugging Face model card `Qwen/Qwen3.5-2B` lists `License: apache-2.0` | Keep the license and NOTICE; no attribution display required by the card | **Verified on the official card for 2B**; the exact GGUF we would ship (its repo and file hash) must be checked too — conversions can carry different terms |
| gemma4 e2b / 12B | Apache-2.0 — Google Open Source Blog, "Gemma 4: Expanding the Gemmaverse with Apache 2.0" (2026-03) | Apache terms; older Gemma (≤3) stay under the Gemma Terms of Use | Verified at the announcement level; confirm the license file in the exact GGUF repo |
| llama3.2 3B (fallback) | Llama 3.2 Community License (dev.meta.ai) | Display "Built with Llama"; ship a copy of the agreement and a Notice file; follow the Acceptable Use Policy; >700 M MAU needs a Meta license | Verified; heavier obligations than Apache |
| llama3.1 8B (current) | Llama 3.1 Community License | Same family of obligations | Today it is pulled by the user's own Ollama, not redistributed by Berean |
| nomic-embed-text / mxbai-embed-large | not checked | — | Only relevant if semantic retrieval ships (Phase 3 decides) |

Recommendation: prefer the Apache-2.0 families (qwen3.5, gemma4) for anything Berean downloads on the user's behalf; llama3.2 only with the attribution/Notice work done.

## Runtime options

| Option | Mac | iPhone | MAS fit (inferred from repo + sources) | Verdict |
|---|---|---|---|---|
| Keep Ollama | works today | no | needs a separate install and a localhost daemon; against "no CLI setup" | Fallback during migration only |
| llama.cpp `llama-server` helper over localhost | possible | no | **`network.server` is forbidden by `scripts/mac/verify-mas.mjs`** | Rejected |
| node-llama-cpp in an Electron utility process | prebuilt Metal binaries | no | Same pattern as Electron's experimental `@electron/llm`. Signing works like our `.node` addons; whether the utility process inheriting the sandbox can compile Metal shaders is **not tested** | **Spike candidate A** |
| Own Node-API addon over the official llama.cpp build | yes | — | Direct precedent: `berean_glass.node` / `berean_icloud.node` (in-house Node-API, signed in bundle, `process.dlopen`) | **Spike candidate B** (more control, more work) |
| llama.cpp XCFramework (official release asset `llama-bNNNN-xcframework.zip`, Metal) | via addon | SPM binary target in `ios/App/BereanNative` | iOS precedent: onnxruntime binary package + MinimumOSVersion fix step | **iPhone path** |
| Apple Foundation Models | macOS 26+ | iOS 26+, Apple Intelligence devices | Berean supports macOS 12 / iOS 17 | Optional extra provider later; **not tested** |

## Spike plan (needs Michael)

1. Build a MAS-dev package (`npm run build:mas:dev`) with candidate A in a utility process, open it sandboxed, load qwen3.5 2B from the app container, run one prompt. Pass = loads, Metal used, no new entitlement, `verify-mas` clean.
   - **Needs:** the MAS dev provisioning profile and certificates on this Mac (`build/embedded.provisionprofile` is absent in the worktree), and approval for the ~1.9 GB model download.
2. If A fails, repeat with B.
3. iPhone: add the XCFramework to BereanNative behind a flag; load the same GGUF on a physical iPhone; measure load time, tokens/s, peak memory, thermal state. **Needs:** a physical device (Claude can't run it).

## Sources
- [Qwen/Qwen3.5-2B model card](https://huggingface.co/Qwen/Qwen3.5-2B)
- [Gemma 4: Expanding the Gemmaverse with Apache 2.0](https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html)
- [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
- [Llama 3.2 Community License](https://dev.meta.ai/llama/llama3_2/license)
- [electron/llm](https://github.com/electron/llm) · [node-llama-cpp](https://github.com/withcatai/node-llama-cpp)
- [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) · [mattt/llama.swift](https://github.com/mattt/llama.swift)

# Ollama removal — owner-requested local environment change

2026-11-19. The owner requested removal of unused Ollama because its model files consumed substantial Mac disk space. This is a local environment change, not a Berean product feature or removal of Berean's optional integration.

- **REMOVED:** `~/.ollama/models` downloaded model directory, measured 41,559,888 KiB (about39.6GiB) before deletion. Model downloads were permanently removed to reclaim space; the rest went to recoverable Trash.
- **STOPPED/VERIFIED:** exact Ollama app/server processes; subsequent process inventory found none and `ollama` is unavailable on PATH.
- **RECOVERABLE:** `/Applications/Ollama.app`, remaining `~/.ollama` settings/history/keys/logs, Ollama-specific Application Support, both known caches, preferences and WebKit files were moved to `/Users/roywe/.Trash/Ollama removal 2026-11-19 22-11-38`. No key/history content was printed or committed. Do not empty the owner's Trash.
- **VERIFIED:** app/user directory gone; no Ollama-named entries remained in the checked user Library Application Support/Caches/Logs/Preferences/Saved Application State/HTTPStorages/WebKit/LaunchAgents/Containers/Group Containers/Application Scripts. No Ollama launch-agent/daemon plist was found in the inspected system/user launch directories. Free disk space at final observation was about49GiB; total free space varies with other system activity.
- **REMAINS:** root-owned `/usr/local/bin/ollama` symlink pointing at the removed app. Ordinary unlink was denied; `sudo -n` required a password. It is a negligible, nonfunctional shortcut, not a running service/model. Removing it requires the owner to authenticate, e.g. `sudo unlink /usr/local/bin/ollama`. No password/privilege bypass attempted.
- **PRESERVED:** Berean source/integration, notes/databases/sync/signing, other AI tools and unrelated models. Local optional Ollama features cannot run unless Ollama/models are reinstalled.

Temporary detailed path/process/space report: `/private/tmp/berean-ollama-removal.json`. It is supporting local evidence and may disappear. No broad filesystem scan or blanket deletion of AI files was used.

## Native work interrupted and ready to resume

Codex owns uncommitted `Packages/BereanKit/Sources/BereanNotes/NoteScriptureBlocks.swift`: candidate/ratio scanner adapted from the preserved prototype, with Hermas parameter and length-preserving reference-space normalization. It has not been compiled, tested or connected to editors/settings. Do not mark it delivered; retain it in this checkout and continue tests/canonical verification/both editors from NOTES-AUTOMATIC-BLOCKS. The durable original draft remains under prototypes.

#!/bin/bash
# Publish the transcript packs (docs/mobile/decisions.md D-007) as assets of a GitHub release the
# iPhone app downloads from on demand. Run after scripts/data/split-youtube-seed.mjs.
#
#   scripts/data/publish-transcripts.sh            # tag transcripts-v<seedVersion> from the manifest
#
# Requires the GitHub CLI (`gh auth login`). The app's default base URL is
# https://github.com/RoyalWeden/Berean/releases/download/transcripts-v<seedVersion>/ — a different
# host works too: set the `transcriptPacksBaseUrl` setting on the phone (Settings → YouTube).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/data/youtube_transcripts"
[ -f "$DIR/manifest.json" ] || { echo "no manifest — run: node scripts/data/split-youtube-seed.mjs" >&2; exit 1; }
VERSION=$(python3 -c "import json;print(json.load(open('$DIR/manifest.json'))['seedVersion'])")
TAG="transcripts-v$VERSION"
echo "[transcripts] release $TAG"
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --title "YouTube transcript packs v$VERSION" --notes "Per-channel transcript packs for the Berean iPhone app (downloaded on demand; SHA-256 in manifest.json). Not needed on the Mac." --latest=false
fi
gh release upload "$TAG" "$DIR"/*.db "$DIR/manifest.json" --clobber
echo "[transcripts] uploaded $(ls "$DIR"/*.db | wc -l | tr -d ' ') packs + manifest"

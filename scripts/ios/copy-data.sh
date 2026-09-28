#!/bin/bash
# Xcode run-script phase: copy the allow-listed bundled databases (scripts/ios/bundled-dbs.txt)
# from <repo>/data into the app bundle at App.app/data/. Follows symlinks (worktrees symlink
# each data/*.db to the main checkout — see scripts/setup-worktree.sh) and skips unchanged files
# so incremental builds stay fast. Fails the build loudly if a listed file is missing, since a
# missing text DB would silently become an empty book list on the phone.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIST="$ROOT/scripts/ios/bundled-dbs.txt"
SRC="$ROOT/data"
DEST="${BUILT_PRODUCTS_DIR:?}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?}/data"
mkdir -p "$DEST"
missing=0
while IFS= read -r line; do
  name="${line%%#*}"; name="${name// /}"
  [ -z "$name" ] && continue
  src="$SRC/$name"
  if [ ! -e "$src" ]; then echo "error: bundled database missing: $src" >&2; missing=1; continue; fi
  real="$(cd "$(dirname "$src")" && python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$src")"
  if [ ! -f "$DEST/$name" ] || [ "$real" -nt "$DEST/$name" ] || [ "$(stat -f %z "$real")" != "$(stat -f %z "$DEST/$name")" ]; then
    cp -L "$real" "$DEST/$name"
    echo "copied $name"
  fi
done < "$LIST"
# Remove anything in the bundle's data/ that is no longer allow-listed.
for f in "$DEST"/*.db; do
  [ -e "$f" ] || continue
  b="$(basename "$f")"
  grep -qx "$b" "$LIST" || { rm -f "$f"; echo "removed stale $b"; }
done
# Transcript pack manifest (D-007): lets the app list downloadable channel packs offline.
# Optional — a build without it just shows "no transcript packs in this build".
if [ -f "$SRC/youtube_transcripts/manifest.json" ]; then
  cp -L "$SRC/youtube_transcripts/manifest.json" "$DEST/youtube_transcripts.manifest.json"
  # ...and into the web root, where the renderer can fetch it as ./youtube_transcripts.manifest.json
  cp -L "$SRC/youtube_transcripts/manifest.json" "${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/public/youtube_transcripts.manifest.json" 2>/dev/null || true
fi
[ "$missing" -eq 0 ] || exit 1

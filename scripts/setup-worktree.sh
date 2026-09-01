#!/usr/bin/env bash
#
# setup-worktree.sh — wire a freshly-created git worktree so it can build/run/test.
#
# A new `git worktree add` checkout is missing every gitignored local-only file the
# app needs: the Bible/lexicon SQLite databases, the real YouTube API key, and
# node_modules. Without electron/youtube-key.ts in particular, `npm run dev` dies with:
#   ERROR  Could not resolve "../youtube-key" from "electron/ipc/youtube.ts"
#
# Run this once from inside the new worktree:
#   bash scripts/setup-worktree.sh
# or via the npm alias:
#   npm run setup:worktree
#
# It symlinks each needed path back to the MAIN working tree (the first entry in
# `git worktree list`). Re-running is safe — existing correct links are left alone.
set -euo pipefail

here="$(git rev-parse --show-toplevel)"
main="$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')"

if [[ "$here" == "$main" ]]; then
  echo "Refusing to run inside the main working tree ($main)." >&2
  echo "Run this from inside a NEW worktree created with 'git worktree add'." >&2
  exit 1
fi

echo "Worktree : $here"
echo "Main tree: $main"
echo

link() {
  # link <relative-path>  — symlink $here/<path> -> $main/<path>
  local rel="$1"
  local src="$main/$rel"
  local dst="$here/$rel"
  if [[ ! -e "$src" ]]; then
    echo "  skip  $rel  (not present in main tree)"
    return
  fi
  if [[ -L "$dst" && "$(readlink "$dst")" == "$src" ]]; then
    echo "  ok    $rel"
    return
  fi
  rm -rf "$dst"
  ln -s "$src" "$dst"
  echo "  link  $rel"
}

# node_modules — one big symlink (never `npm install` in a worktree; it silently
# materialises a real 1.1G copy and versions drift from main).
link "node_modules"

# Real YouTube API key (gitignored; youtube-key.example.ts is the only committed one).
link "electron/youtube-key.ts"

# Bundled data — symlink each *.db individually. Never `ln -s .../data data`: the
# data/ dir already exists in the checkout, so that nests into data/data.
mkdir -p "$here/data"
shopt -s nullglob
for db in "$main"/data/*.db; do
  link "data/$(basename "$db")"
done
shopt -u nullglob

echo
echo "Done. You can now run 'npm run dev' / 'npm test' in this worktree."

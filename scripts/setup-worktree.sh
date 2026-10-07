#!/usr/bin/env bash
#
# setup-worktree.sh — wire a freshly-created git worktree so it can build/run/test.
#
# A new `git worktree add` checkout is missing every gitignored local-only file the
# app needs: the Bible/lexicon SQLite databases, the real YouTube API key, the iOS
# Signing.xcconfig, and node_modules. Without electron/youtube-key.ts in particular, `npm run dev` dies with:
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
  # A REAL file/dir already here is deliberate local state (e.g. a data/*.db being repaired in this
  # worktree) — never replace it. Only a missing path or a wrong symlink is (re)linked.
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "  keep  $rel  (local file — not replaced)"
    return
  fi
  rm -f "$dst"
  ln -s "$src" "$dst"
  echo "  link  $rel"
}

# node_modules — never `npm install` in a worktree (it materialises a real 1.1G copy and versions
# drift from main). Instead node_modules is a REAL directory whose entries are symlinks into main's
# node_modules, EXCEPT the iOS Capacitor plugin packages (every node_modules/@capacitor/* that has
# a Package.swift — ~2 MB in total), which are COPIED (rsync, re-synced on every run).
#
# Why the copies: ios/App/CapApp-SPM/Package.swift references each plugin as a LOCAL Swift
# package under node_modules. Xcode opens a given local package in only ONE workspace at a time.
# When node_modules was one big symlink, the worktree's plugin packages WERE main's
# (/Users/roywe/Berean/node_modules/@capacitor/app …), so with main's App.xcodeproj also open in
# Xcode the worktree showed "Missing package product 'app_CapacitorApp'" (and the other eight),
# and `cap sync` rewrote the tracked Package.swift to ../../../../Berean/node_modules/... paths.
# Worktree-local copies give every checkout its own package locations.
# Cache directories (.vite, .cache) stay local so dev servers don't write into main's.
nm="$here/node_modules"
if [[ -L "$nm" ]]; then
  rm "$nm"   # the old single symlink (removes the link only, never main's node_modules)
  echo "  migrate node_modules (single symlink → per-package links)"
fi
mkdir -p "$nm"
shopt -s nullglob dotglob
for entry in "$main"/node_modules/*; do
  name="$(basename "$entry")"
  case "$name" in .vite|.cache) continue ;; esac
  if [[ "$name" == "@capacitor" ]]; then
    if [[ -L "$nm/@capacitor" ]]; then rm "$nm/@capacitor"; fi
    mkdir -p "$nm/@capacitor"
    for pkg in "$entry"/*; do
      pname="$(basename "$pkg")"
      if [[ -f "$pkg/Package.swift" ]]; then
        # iOS plugin (local Swift package): a worktree-local copy, kept identical to main's.
        if [[ -L "$nm/@capacitor/$pname" ]]; then rm "$nm/@capacitor/$pname"; fi
        rsync -a --delete "$pkg/" "$nm/@capacitor/$pname/"
        echo "  copy  node_modules/@capacitor/$pname  (iOS Swift package)"
      else
        link "node_modules/@capacitor/$pname" >/dev/null
      fi
    done
  else
    link "node_modules/$name" >/dev/null
  fi
done
shopt -u nullglob dotglob
echo "  ok    node_modules  (per-package links into main; iOS plugins copied)"

# Signing (gitignored; DEVELOPMENT_TEAM etc.) — device and archive builds need it.
link "ios/App/Signing.xcconfig"

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
echo "iOS: run 'npm run ios:sync' (or ios:sync:dev) before opening Xcode — it regenerates"
echo "ios/App/CapApp-SPM/Package.swift against this worktree's own plugin packages."

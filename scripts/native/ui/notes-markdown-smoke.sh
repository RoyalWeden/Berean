#!/bin/zsh
# UI regression: Markdown export/import through the REAL native Mac interface (menus, save/open panels).
# Added after "Share did nothing" (2026-11-08). Drives the running dev app with System Events, so it needs
# Accessibility permission for the terminal and runs locally only (not on CI). Uses the native DEV library
# (com.berean.native.mac.dev) — never production data. Leaves one note titled "UI smoke <time>" in that library.
#
#   npm run native:build:mac && scripts/native/ui/notes-markdown-smoke.sh
set -euo pipefail
APP="$(cd "$(dirname "$0")/../../.." && pwd)/build/apple/DerivedData/Build/Products/Debug/BereanMac.app"
DB="$HOME/Library/Containers/com.berean.native.mac.dev/Data/Library/Application Support/BereanNative/berean.db"
OUT="$(mktemp -d)"; STAMP="$(date +%H%M%S)"; TITLE="UI smoke $STAMP"; FILE="$OUT/$TITLE.md"
P='tell application "System Events" to tell (first process whose bundle identifier is "com.berean.native.mac.dev") to'
menu() { osascript -e "$P click menu item \"$1\" of menu \"$2\" of menu bar 1" >/dev/null; }
keys() { osascript -e "tell application \"System Events\" to keystroke \"$1\""; }
ret() { osascript -e 'tell application "System Events" to key code 36'; }
goto() { osascript -e 'tell application "System Events" to keystroke "g" using {command down, shift down}'; sleep 1; keys "$1"; sleep 0.5; ret; sleep 1; }
fail() { echo "FAIL: $1"; exit 1; }

pgrep -f "BereanMac.app/Contents/MacOS" >/dev/null || { open "$APP"; sleep 4; }
osascript -e "$P set frontmost to true"; sleep 1

menu "New Note" "File"; sleep 1.5
keys "$TITLE"; ret; sleep 0.5; keys "Smoke body line"; sleep 2   # autosave runs after 600 ms

menu "Export Note as Markdown…" "File"; sleep 1.5
goto "$OUT"; ret; sleep 2
[[ -f "$FILE" ]] || fail "export did not create $FILE"
grep -q "^title: \"$TITLE\"$" "$FILE" || fail "exported file lacks the title line"
grep -q "^berean_id: " "$FILE" || fail "exported file lacks berean_id"
grep -q "Smoke body line" "$FILE" || fail "exported file lacks the body"
echo "ok - export wrote $FILE"

sed -i '' 's/Smoke body line/Smoke body edited/' "$FILE"
menu "Import Markdown…" "File"; sleep 1.5
goto "$FILE"; ret; sleep 2; ret; sleep 1          # second Return dismisses the "Imported…" alert
got="$(sqlite3 "$DB" "SELECT content FROM notes WHERE title = '$TITLE' AND deleted_at IS NULL")"
[[ "$got" == *"Smoke body edited"* ]] || fail "import did not update the note (content: $got)"
[[ "$(sqlite3 "$DB" "SELECT count(*) FROM notes WHERE title = '$TITLE'")" == 1 ]] || fail "import created a duplicate"
echo "ok - import updated the same note"

menu "Export Note as Markdown…" "File"; sleep 1.5
osascript -e 'tell application "System Events" to key code 53'; sleep 1   # Escape = cancel
osascript -e "$P count sheets of window 1" | grep -qx 0 || fail "a sheet/alert is still open after cancelling"
echo "ok - cancel leaves no alert"
rm -rf "$OUT"
echo "PASS"

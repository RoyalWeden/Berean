"""
Delete transcript rows that were wrongly recorded as permanent "no transcript" failures
because of a bug in extractOneVideo() (electron/ipc/youtube.ts): any non-2xx response from
tactiq's transcript API (including 429 rate-limit responses) was treated the same as tactiq's
own 418 "this video genuinely has no captions" signal — a real, one-request rate-limit hiccup
got recorded exactly like a permanent absence, and fetchTranscripts' candidate query excludes
any video_id that already has ANY row in youtube_transcripts, so a rate-limited video could
never be attempted again.

Removes only rows whose error is exactly "no transcript (API <code>)" for a code OTHER than
418 (confirmed via query: every affected row in this DB is "no transcript (API 429)" — this
also covers any other non-418 code, in case a different run recorded one). Rows with error
"no transcript (API 418)" or the tactiq-native "no transcript available" message are left
alone — those are genuinely permanent.

Usage: python3 scripts/fix_transcript_429_misclassification.py <path-to-berean.db>
Always makes a `<db>.bak-transcript-429-fix` copy before writing.
"""
import sqlite3, os, shutil, sys, re

if len(sys.argv) != 2:
    raise SystemExit(f'Usage: python3 {sys.argv[0]} <path-to-berean.db>')

DB = sys.argv[1]
if not os.path.exists(DB):
    raise SystemExit(f'No such file: {DB}')

BACKUP = DB + '.bak-transcript-429-fix'
if os.path.exists(BACKUP):
    raise SystemExit(f'Backup already exists ({BACKUP}) — this script has likely already run against this file.')
shutil.copyfile(DB, BACKUP)
print(f'Backed up {DB} -> {BACKUP}')

conn = sqlite3.connect(DB)
cur = conn.cursor()

rows = cur.execute(
    "SELECT video_id, error FROM youtube_transcripts WHERE error LIKE 'no transcript (API %)'"
).fetchall()
to_delete = [vid for vid, error in rows if not re.fullmatch(r'no transcript \(API 418\)', error)]
print(f'Found {len(rows)} "API <code>" error rows, {len(to_delete)} are mis-classified (non-418) and will be removed')

if to_delete:
    placeholders = ','.join('?' * len(to_delete))
    cur.execute(f'DELETE FROM youtube_transcripts WHERE video_id IN ({placeholders})', to_delete)
    print(f'Deleted {cur.rowcount} rows — these videos are eligible candidates again on the next "Get transcripts" run')

conn.commit()
conn.close()
print('Done.')

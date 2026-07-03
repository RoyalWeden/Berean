#!/usr/bin/env python3
"""
Audit data/lxx_brenton.db for missing content against the canonical source
(ebible.org eng-Brenton USFX — the same source seed_lxx_missing.py uses).

Download first:
  curl -sL -o /tmp/brenton_usfx.zip https://ebible.org/Scriptures/eng-Brenton_usfx.zip
  unzip -o /tmp/brenton_usfx.zip eng-Brenton_usfx.xml -d /tmp

Then:  python3 scripts/audit_lxx_completeness.py /tmp/eng-Brenton_usfx.xml

For every book present in both the DB and the source, diffs verse counts per
chapter and reports any chapter where the source has verses the DB doesn't.
Also reports source books that don't exist in the DB at all.

Read-only — makes no changes to the database.
"""
import sys, re, sqlite3, os, html

# USFX book id -> our DB book id. DAG (Daniel + Greek additions) maps to DAN.
# FRT/INT/OTH/XXA/XXB/XXC/BAK are front matter / appendix / footnotes, not books — skipped.
USFX_TO_DB = {
    'GEN': 'GEN', 'EXO': 'EXO', 'LEV': 'LEV', 'NUM': 'NUM', 'DEU': 'DEU',
    'JOS': 'JOS', 'JDG': 'JDG', 'RUT': 'RUT', '1SA': '1SA', '2SA': '2SA',
    '1KI': '1KI', '2KI': '2KI', '1CH': '1CH', '2CH': '2CH', 'EZR': 'EZR',
    'NEH': 'NEH', 'JOB': 'JOB', 'PSA': 'PSA', 'PRO': 'PRO', 'ECC': 'ECC',
    'SNG': 'SNG', 'ISA': 'ISA', 'JER': 'JER', 'LAM': 'LAM', 'HOS': 'HOS',
    'AMO': 'AMO', 'OBA': 'OBA', 'JON': 'JON', 'MIC': 'MIC', 'NAM': 'NAM',
    'EZK': 'EZK', 'JOL': 'JOL',
    'HAB': 'HAB', 'ZEP': 'ZEP', 'HAG': 'HAG', 'ZEC': 'ZEC', 'MAL': 'MAL',
    'TOB': 'TOB', 'JDT': 'JDT', 'ESG': 'ESG', 'WIS': 'WIS', 'SIR': 'SIR',
    'BAR': 'BAR', 'SUS': 'SUS', 'BEL': 'BEL', '1MA': '1MA', '2MA': '2MA',
    '1ES': '1ES', '3MA': '3MA', '4MA': '4MA', 'DAG': 'DAN',
    'LJE': 'LJE',  # Epistle of Jeremy — added by scripts/seed_lxx_lje_man.py
    'MAN': 'PRM',  # Prayer of Manasses — added by scripts/seed_lxx_lje_man.py (app uses id 'PRM')
}
NOT_BOOKS = {'FRT', 'INT', 'OTH', 'XXA', 'XXB', 'XXC', 'BAK'}

usfx_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/eng-Brenton_usfx.xml'
db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'lxx_brenton.db')

if not os.path.exists(usfx_path):
    sys.exit(f'USFX not found: {usfx_path} (download it first — see header)')

xml = open(usfx_path, encoding='utf-8').read()

def clean(text: str) -> str:
    text = re.sub(r'<f\b.*?</f>', '', text, flags=re.DOTALL)
    text = re.sub(r'<x\b.*?</x>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    text = text.replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def parse_book(usfx_id: str):
    m = re.search(rf'<book id="{usfx_id}">(.*?)</book>', xml, re.DOTALL)
    if not m:
        return []
    body = m.group(1)
    parts = re.split(r'(<v\b[^>]*/>)', body)
    cur = None
    verses = []
    for p in parts:
        vm = re.match(r'<v\b[^>]*bcv="([^"]+)"', p)
        if vm:
            if cur:
                verses.append(cur)
            bcv = vm.group(1).split('.')
            # Some verses carry a letter suffix for split-verse versification (e.g. "2c") —
            # strip it so 2a/2b/2c all compare against DB verse_num 2 (the DB doesn't split them).
            verse_num = int(re.match(r'\d+', bcv[2]).group())
            cur = {'chapter': int(bcv[1]), 'verse': verse_num, 'text': ''}
        elif cur is not None:
            cur['text'] += p
    if cur:
        verses.append(cur)
    out = []
    for v in verses:
        t = clean(v['text'])
        if t:
            out.append((v['chapter'], v['verse'], t))
    return out

# Sanity check: every top-level <book id="..."> in the source is accounted for.
all_source_ids = set(re.findall(r'<book id="([A-Za-z0-9]+)">', xml))
unaccounted = all_source_ids - set(USFX_TO_DB) - NOT_BOOKS
if unaccounted:
    print(f'WARNING: unaccounted source book ids (add to USFX_TO_DB or NOT_BOOKS): {sorted(unaccounted)}')

conn = sqlite3.connect(db_path)
db_book_ids = {row[0] for row in conn.execute('SELECT id FROM books')}

print('=== Books present in source but entirely missing from the DB ===')
missing_books = [uid for uid, dbid in USFX_TO_DB.items() if dbid is None]
for uid in missing_books:
    rows = parse_book(uid)
    n_ch = max((r[0] for r in rows), default=0)
    print(f'  {uid}: {n_ch} chapters, {len(rows)} verses in source — NOT in DB')

print()
print('=== Per-chapter verse count gaps (source has more verses than DB) ===')
total_gap_chapters = 0
total_gap_verses = 0
for uid, dbid in USFX_TO_DB.items():
    if dbid is None:
        continue
    if dbid not in db_book_ids:
        print(f'  [skip] {dbid}: not in DB at all')
        continue
    src_rows = parse_book(uid)
    if not src_rows:
        continue
    src_counts = {}
    for ch, v, t in src_rows:
        src_counts.setdefault(ch, set()).add(v)

    db_counts = {}
    for ch, v in conn.execute('SELECT chapter, verse_num FROM verses WHERE book_id=?', (dbid,)):
        db_counts.setdefault(ch, set()).add(v)

    for ch in sorted(src_counts):
        src_verses = src_counts[ch]
        db_verses = db_counts.get(ch, set())
        missing = src_verses - db_verses
        if missing:
            total_gap_chapters += 1
            total_gap_verses += len(missing)
            print(f'  {dbid} {ch}: DB has {len(db_verses)} verses, source has {len(src_verses)} '
                  f'(missing verse_num {sorted(missing)})')

print()
print(f'Summary: {total_gap_chapters} chapters with gaps, {total_gap_verses} missing verses total, '
      f'{len(missing_books)} books missing entirely.')
conn.close()

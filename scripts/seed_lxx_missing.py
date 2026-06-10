#!/usr/bin/env python3
"""
Seed the 5 OT books missing from data/lxx_brenton.db (Brenton Septuagint):
  Ezekiel (EZK), Daniel (DAN, from USFX 'DAG'), Joel (JOL), Nahum (NAM),
  Song of Songs (SNG).

Source: ebible.org eng-Brenton USFX  (public domain, Brenton's 1851 translation).
Download first:
  curl -sL -o /tmp/brenton_usfx.zip https://ebible.org/Scriptures/eng-Brenton_usfx.zip
  unzip -o /tmp/brenton_usfx.zip eng-Brenton_usfx.xml -d /tmp

Then:  python3 scripts/seed_lxx_missing.py /tmp/eng-Brenton_usfx.xml

Idempotent: deletes any existing rows for the 5 books before re-inserting.
After running:  npm run convert-dbs  (WAL->DELETE), then npm run data:publish.
"""
import sys, re, sqlite3, os, html

USFX_BOOK_TO_ID = {'EZK': 'EZK', 'JOL': 'JOL', 'NAM': 'NAM', 'SNG': 'SNG', 'DAG': 'DAN'}
BOOK_META = {  # id -> (name, short_name)
    'EZK': ('Ezekiel', 'Ezek'), 'DAN': ('Daniel', 'Dan'), 'JOL': ('Joel', 'Joel'),
    'NAM': ('Nahum', 'Nah'), 'SNG': ('Song of Songs', 'Song'),
}

usfx_path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/eng-Brenton_usfx.xml'
db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'lxx_brenton.db')

if not os.path.exists(usfx_path):
    sys.exit(f'USFX not found: {usfx_path} (download it first — see header)')

xml = open(usfx_path, encoding='utf-8').read()

def clean(text: str) -> str:
    # Drop footnotes/cross-refs entirely, then strip all remaining inline tags.
    text = re.sub(r'<f\b.*?</f>', '', text, flags=re.DOTALL)
    text = re.sub(r'<x\b.*?</x>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', '', text)          # strip tags (<sc>, <add>, <w>, <ve/>, ...)
    text = html.unescape(text)
    text = text.replace('\n', ' ')
    text = re.sub(r'\s+', ' ', text).strip()
    return text

# Parse one book's verses using the bcv attribute as the source of truth.
def parse_book(usfx_id: str):
    m = re.search(rf'<book id="{usfx_id}">(.*?)</book>', xml, re.DOTALL)
    if not m:
        return []
    body = m.group(1)
    # Split on verse markers; each <v ... bcv="BOOK.C.V" /> begins a verse, text runs to next marker.
    verses = []
    parts = re.split(r'(<v\b[^>]*/>)', body)
    cur = None
    for p in parts:
        vm = re.match(r'<v\b[^>]*bcv="([^"]+)"', p)
        if vm:
            if cur:
                verses.append(cur)
            bcv = vm.group(1).split('.')   # e.g. EZK.1.1
            cur = {'chapter': int(bcv[1]), 'verse': int(bcv[2]), 'text': ''}
        elif cur is not None:
            # Stop accruing at the next book/chapter boundary fragments are fine; clean handles tags.
            cur['text'] += p
    if cur:
        verses.append(cur)
    out = []
    seen = set()
    for v in verses:
        t = clean(v['text'])
        key = (v['chapter'], v['verse'])
        if t and key not in seen:   # DAG (Daniel + Greek additions) repeats some refs; keep first
            seen.add(key)
            out.append((v['chapter'], v['verse'], t))
    return out

conn = sqlite3.connect(db_path)
conn.execute('PRAGMA journal_mode=DELETE')
cur = conn.cursor()

# Space out existing sort_order if not already spaced (idempotent: only scale once).
maxso = cur.execute('SELECT MAX(sort_order) FROM books').fetchone()[0] or 0
if maxso < 100:
    cur.execute('UPDATE books SET sort_order = sort_order * 10')

# Neighbor anchors (after scaling: ECC=200, JOB=210, LAM=340, SUS=350, MIC=390, OBA=400, JON=410, HAB=420)
NEW_SORT = {'SNG': 205, 'EZK': 342, 'DAN': 344, 'JOL': 395, 'NAM': 415}

total = 0
for usfx_id, book_id in USFX_BOOK_TO_ID.items():
    rows = parse_book(usfx_id)
    if not rows:
        print(f'  [skip] {usfx_id}: no verses parsed')
        continue
    name, short = BOOK_META[book_id]
    chapters = max(r[0] for r in rows)
    # Replace any existing data for this book
    cur.execute('DELETE FROM verses WHERE book_id = ?', (book_id,))
    cur.execute('DELETE FROM books WHERE id = ?', (book_id,))
    cur.execute(
        'INSERT INTO books (id, name, short_name, testament, chapters_count, sort_order) VALUES (?,?,?,?,?,?)',
        (book_id, name, short, 'OT', chapters, NEW_SORT[book_id]))
    cur.executemany(
        'INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?,?,?,?)',
        [(book_id, c, v, t) for (c, v, t) in rows])
    total += len(rows)
    print(f'  [ok] {book_id} ({name}): {chapters} chapters, {len(rows)} verses')

conn.commit()
conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
conn.close()
print(f'Done. Inserted {total} verses across 5 books into {os.path.relpath(db_path)}')
print('Next: npm run convert-dbs && npm run data:publish, then tag a release.')

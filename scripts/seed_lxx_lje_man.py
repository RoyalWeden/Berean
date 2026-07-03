#!/usr/bin/env python3
"""
Add the Epistle/Letter of Jeremy (LJE) and Prayer of Manasses (MAN) to
data/lxx_brenton.db — found missing entirely by scripts/audit_lxx_completeness.py.

Source: ebible.org eng-Brenton USFX (same source as seed_lxx_missing.py).
Download first:
  curl -sL -o /tmp/brenton_usfx.zip https://ebible.org/Scriptures/eng-Brenton_usfx.zip
  unzip -o /tmp/brenton_usfx.zip eng-Brenton_usfx.xml -d /tmp

Then:  python3 scripts/seed_lxx_lje_man.py /tmp/eng-Brenton_usfx.xml

Idempotent: deletes any existing rows for these 2 books before re-inserting.
After running:  npm run convert-dbs (WAL->DELETE), then npm run data:publish.
"""
import sys, re, sqlite3, os, html

# USFX source id -> (DB book id, name, short_name, testament, sort_order).
# The DB id for Prayer of Manasses is 'PRM' (not the USFX 'MAN') to match the id already
# registered in src/lib/parseRef.ts's book list.
BOOK_META = {
    'LJE': ('LJE', 'Letter of Jeremiah', 'Ep.Jer', 'Apocrypha', 335),  # follows Baruch, precedes Lamentations
    'MAN': ('PRM', 'Prayer of Manasses', 'Pr.Man', 'Apocrypha', 305),  # follows 4 Maccabees, precedes Isaiah
}

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
            verse_num = int(re.match(r'\d+', bcv[2]).group())
            cur = {'chapter': int(bcv[1]), 'verse': verse_num, 'text': ''}
        elif cur is not None:
            cur['text'] += p
    if cur:
        verses.append(cur)
    out = []
    seen = set()
    for v in verses:
        t = clean(v['text'])
        key = (v['chapter'], v['verse'])
        if t and key not in seen:
            seen.add(key)
            out.append((v['chapter'], v['verse'], t))
    return out

conn = sqlite3.connect(db_path)
conn.execute('PRAGMA journal_mode=DELETE')
cur = conn.cursor()

total = 0
for usfx_id, (db_id, name, short, testament, sort_order) in BOOK_META.items():
    rows = parse_book(usfx_id)
    if not rows:
        print(f'  [skip] {usfx_id}: no verses parsed')
        continue
    chapters = max(r[0] for r in rows)
    cur.execute('DELETE FROM verses WHERE book_id = ?', (db_id,))
    cur.execute('DELETE FROM books WHERE id = ?', (db_id,))
    cur.execute(
        'INSERT INTO books (id, name, short_name, testament, chapters_count, sort_order) VALUES (?,?,?,?,?,?)',
        (db_id, name, short, testament, chapters, sort_order))
    cur.executemany(
        'INSERT INTO verses (book_id, chapter, verse_num, text) VALUES (?,?,?,?)',
        [(db_id, c, v, t) for (c, v, t) in rows])
    total += len(rows)
    print(f'  [ok] {db_id} ({name}): {chapters} chapters, {len(rows)} verses')

conn.commit()
conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
conn.close()
print(f'Done. Inserted {total} verses across {len(BOOK_META)} books into {os.path.relpath(db_path)}')
print('Next: npm run convert-dbs && npm run data:publish, then tag a release.')

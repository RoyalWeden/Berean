#!/usr/bin/env python3
"""Validates every gold reference / Strong's id in cases.jsonl against Berean's real data/*.db
(read-only) and writes gold_resolved.json with the stored text and lexicon facts used by scoring."""
import json, re, sqlite3, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / 'data'
TEXT_FILES = {'kjva': 'kjva.db', 'kjv': 'kjv.db', 'lxx': 'lxx_brenton.db', 'enoch': 'enoch.db', 'jubilees': 'jubilees.db',
              't12p': 't12p.db', 'hermas_taylor': 'hermas_taylor.db', '1clement': '1clement.db'}
_dbs = {}
def db(name):
    if name not in _dbs:
        _dbs[name] = sqlite3.connect(f'file:{DATA / name}?mode=ro', uri=True)
    return _dbs[name]

def parse(ref):
    text = 'kjva'
    if ':' in ref.split(' ')[0]:
        text, ref = ref.split(':', 1)
    m = re.fullmatch(r'(\S+) (\d+):(\d+)', ref)
    return text, m.group(1), int(m.group(2)), int(m.group(3))

def verse(ref):
    t, b, c, v = parse(ref)
    cols = [r[1] for r in db(TEXT_FILES[t]).execute('PRAGMA table_info(verses)')]
    row = db(TEXT_FILES[t]).execute(f"SELECT text, {'text_tagged' if 'text_tagged' in cols else 'NULL'} FROM verses WHERE book_id=? AND chapter=? AND verse_num=?", (b, c, v)).fetchone()
    return row

def entry(sid):
    name = 'strongs_greek.db' if sid[0] == 'G' else 'strongs_hebrew.db'
    r = db(name).execute('SELECT strongs_id, word, transliteration, pronunciation, short_def, derivation, occurrence_count FROM entries WHERE strongs_id=?', (sid,)).fetchone()
    if not r: return None
    occ = db(name).execute('SELECT COUNT(*) FROM occurrences WHERE strongs_id=?', (sid,)).fetchone()[0]
    return {'id': r[0], 'lemma': r[1], 'translit': r[2], 'pron': r[3], 'gloss': r[4], 'derivation': r[5], 'occurrence_count': r[6], 'occurrence_rows': occ}

CASES_FILE = sys.argv[sys.argv.index('--file') + 1] if '--file' in sys.argv else 'cases.jsonl'
cases = [json.loads(l) for l in open(Path(__file__).with_name(CASES_FILE))]
resolved, problems = {}, []
for c in cases:
    refs = c['gold_references'] + c['gold_any'] + [r for g in c['cover_groups'] for r in g] + \
        [m for m in c['must_not_include'] if re.fullmatch(r'(\w+:)?\S+ \d+:\d+', m)]
    for r in refs:
        if r in resolved: continue
        row = verse(r)
        if not row: problems.append(f"{c['id']}: gold ref {r} does not exist"); continue
        resolved[r] = {'text': row[0], 'tagged': row[1]}
    for s in c['gold_strongs']:
        if s in resolved: continue
        e = entry(s)
        if not e: problems.append(f"{c['id']}: gold Strong's {s} does not exist"); continue
        resolved[s] = e
# The non-existent ids the suite relies on must really be absent.
for s in ['G99999', 'H8675', 'H9999']:
    if entry(s): problems.append(f'expected-missing {s} exists')
for r in ['JUD 2:1', 'ROM 17:2', 'lxx:ROM 16:27']:
    try:
        if verse(r): problems.append(f'expected-missing {r} exists')
    except KeyError: pass

out = Path(__file__).with_name('gold_resolved.json' if CASES_FILE == 'cases.jsonl' else CASES_FILE.replace('.jsonl', '_gold_resolved.json'))
out.write_text(json.dumps(resolved, ensure_ascii=False, indent=1))
print(f'{len(resolved)} gold items resolved -> {out}')
print('\n'.join(problems) or 'no problems')
if '--show' in sys.argv:
    for c in cases:
        for r in (c['gold_references'] + c['gold_any'])[:6]:
            if r in resolved and 'text' in resolved[r]:
                print(f"{c['id']:4} {r:18} {resolved[r]['text'][:110]}")

#!/usr/bin/env python3
"""
seed_hermas_taylor.py — Build data/hermas_taylor.db (the Charles Taylor 1903–1906
translation of the Shepherd of Hermas), as a second, switchable Hermas translation
alongside the Roberts-Donaldson hermas.db.

Best-effort OCR ingest. Taylor uses its own (finer, sentence-level) verse divisions
and his own chapter boundaries — which differ from Roberts-Donaldson in several places
and, unlike the RD database, INCLUDE Similitude 7. The app stores the resulting flat
chapter scheme in src/lib/hermasMap.ts (the `*_TAYLOR` section maps); if you change the
parse and the per-section chapter counts shift, update those maps to match.

Source texts (place these two files at the paths below before running):

  SOURCE_VIS_MAN  — Visions + Mandates. Charles Taylor, "The Shepherd of Hermas"
                    Vol. I (SPCK, 1903). Plain-text OCR from archive.org item
                    `shepherdhermas01taylgoog` (the `_djvu.txt`).

  SOURCE_SIM      — Similitudes. Charles Taylor, Vol. II (SPCK, 1906). Extract the
                    PDF with column-aware layout:  pdftotext -layout <pdf> <txt>
                    (a plain `pdftotext` without -layout scrambles the dialogue.)

Each chapter is flagged for human proofreading; chapters with anomalous verse counts
(footnote bleed across OCR page breaks) are flagged `review` and folded conservatively.

Usage:
    pdftotext -layout the_shepherd_of_hermas_vol2.pdf /tmp/hermas_taylor_sim.txt
    python3 scripts/seed_hermas_taylor.py
"""
import os
import re
import sqlite3

ROOT          = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_VIS_MAN = os.environ.get('HERMAS_TAYLOR_VOL1', '/tmp/herm_v1.txt')
SOURCE_SIM     = os.environ.get('HERMAS_TAYLOR_SIM',  '/tmp/hermas_v2_layout.txt')
DB_PATH        = os.path.join(ROOT, 'data', 'hermas_taylor.db')

# ─── structural parser ───────────────────────────────────────────────────────

ORD = {'FIRST':1,'SECOND':2,'THIRD':3,'FOURTH':4,'FIFTH':5,'SIXTH':6,'SEVENTH':7,
       'EIGHTH':8,'NINTH':9,'TENTH':10,'ELEVENTH':11,'TWELFTH':12}

SEC_RE = re.compile(r'^(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)\s+(VISION|MANDATE|COMMANDMENT|SIMILITUDE|PARABLE)\b\s*(.*)$')
# Tolerate OCR digit confusion (O→0, l→1, I→1) — sequential numbering ignores the value
CHAP_RE = re.compile(r'^CHAPTER\s+[IVXLO0-9l]{1,4}\s*[\.\,]?\s*$')
RUNHEAD_RE = re.compile(r'^\s*(\d+\s+)?THE\s+SHEPHERD\s*$', re.I)
PAGENUM_RE = re.compile(r'^\s*[\dIlVXSO/>]{1,5}\s*$')


def norm(t):
    if t in ('MANDATE', 'COMMANDMENT'): return 'MANDATE'
    if t in ('SIMILITUDE', 'PARABLE'): return 'SIMILITUDE'
    return t


def is_runhead(line):
    s = line.strip()
    if RUNHEAD_RE.match(s): return True
    m = SEC_RE.match(s)
    if m and m.group(3).strip(): return True                  # "FIRST VISION 59" etc
    if re.match(r'^(THE\s+)?(VISIONS?|MANDATES?|COMMANDMENTS?|SIMILITUDES?|PARABLES?)\b', s) and not SEC_RE.match(s):
        return True                                            # part-title lines
    if PAGENUM_RE.match(s) and not re.match(r'^\d+\.$', s): return True
    return False


def parse(path, allowed_types):
    """Parse one OCR file into [{type, num, chapters: {flat_ch: {body, notes[]}}}].
    Chapters are numbered sequentially as CHAPTER headers appear (robust against the
    roman/arabic OCR ambiguity); chapterless sections default to a single chapter 1."""
    lines = open(path, encoding='utf-8', errors='replace').read().split('\n')
    start = 0
    for i, l in enumerate(lines):
        m = SEC_RE.match(l.strip())
        if m and norm(m.group(2)) in allowed_types and not m.group(3).strip():
            start = i; break
    sections = []
    cur = None; curch = None; seen = 0; buf = []; fnbuf = []
    footnote = False

    def flush():
        if cur is not None and curch is not None:
            ch = cur['chapters'].setdefault(curch, {'body': '', 'notes': []})
            ch['body'] += ' ' + ' '.join(buf)
            ch['notes'].extend(fnbuf)

    for l in lines[start:]:
        s = l.strip()
        m = SEC_RE.match(s)
        if m and norm(m.group(2)) in allowed_types and not m.group(3).strip():
            flush(); buf = []; fnbuf = []; footnote = False
            cur = {'type': norm(m.group(2)), 'num': ORD[m.group(1)], 'chapters': {}}
            sections.append(cur); curch = None; seen = 0
            continue
        if CHAP_RE.match(s) and cur is not None:
            flush(); buf = []; fnbuf = []; footnote = False
            seen += 1; curch = seen; continue
        if is_runhead(l): footnote = False; continue
        if s == '': continue
        if re.match(r'^[\*†‡§]\s', s) or re.match(r'^[\*†‡§]$', s):
            footnote = True
            fnbuf.append(re.sub(r'^[\*†‡§]\s*', '', s)); continue
        if footnote:
            if re.match(r'^\d{1,3}\.\s', s):
                footnote = False
            else:
                if fnbuf: fnbuf[-1] += ' ' + s
                continue
        if curch is None:                    # body before any CHAPTER header → chapter 1
            curch = 1
        buf.append(s)
    flush()
    return sections


def split_verses(body):
    """Split a chapter body on Taylor's inline "N." verse markers."""
    body = re.sub(r'\s+', ' ', body).strip()
    body = re.sub(r'^I\.\s', '1. ', body)
    parts = re.split(r'(?<!\w)(\d{1,3})\.\s', body)
    verses = {}
    if parts[0].strip():
        verses[1] = parts[0].strip()
    i = 1
    while i < len(parts) - 1:
        n = int(parts[i]); txt = parts[i + 1].strip()
        if 1 <= n <= 60:
            verses[n] = txt
        i += 2
    return verses


# ─── footnote → scripture cross-reference extraction ─────────────────────────

CITE_BOOK = {
    'gen':'GEN','exod':'EXO','exo':'EXO','lev':'LEV','num':'NUM','deut':'DEU',
    'josh':'JOS','judg':'JDG','ruth':'RUT','sam':'SA','kings':'KI','chron':'CH',
    'ezra':'EZR','neh':'NEH','esth':'EST','job':'JOB','ps':'PSA','psa':'PSA','psalm':'PSA',
    'prov':'PRO','eccl':'ECC','cant':'SNG','song':'SNG','isa':'ISA','jer':'JER','lam':'LAM',
    'ezek':'EZK','dan':'DAN','hos':'HOS','joel':'JOL','amos':'AMO','obad':'OBA','jonah':'JON',
    'mic':'MIC','nah':'NAM','hab':'HAB','zeph':'ZEP','hag':'HAG','zech':'ZEC','mal':'MAL',
    'matt':'MAT','mat':'MAT','mark':'MRK','luke':'LUK','john':'JHN','acts':'ACT','rom':'ROM',
    'cor':'CO','gal':'GAL','eph':'EPH','phil':'PHP','col':'COL','thess':'TH','tim':'TI',
    'tit':'TIT','philem':'PHM','heb':'HEB','jas':'JAS','jam':'JAS','pet':'PE','jude':'JUD','rev':'REV',
    'wisd':'WIS','sir':'SIR','ecclus':'SIR','tob':'TOB','jud':'JDT','macc':'MA','bar':'BAR',
    'enoch':'ENOCH','jubilees':'JUB','jub':'JUB',
}
ROMAN_VAL = {'i':1,'ii':2,'iii':3,'iv':4,'v':5,'vi':6,'vii':7,'viii':8,'ix':9,'x':10,
    'xi':11,'xii':12,'xiii':13,'xiv':14,'xv':15,'xvi':16,'xvii':17,'xviii':18,'xix':19,
    'xx':20,'xxi':21,'xxii':22,'xxiii':23,'xxiv':24,'xxv':25,'xxvi':26,'xxvii':27,'xxviii':28,
    'xxix':29,'xxx':30,'xl':40,'l':50,'lx':60,'lxx':70,'lxxx':80,'xc':90,'c':100,
    'cv':105,'cvii':107,'cx':110,'cxviii':118,'cxix':119}
NUMBERED = ('CO','TH','TI','PE','SA','KI','CH','MA')
CITE_RE = re.compile(r'\b([1-3]?\s*[A-Z][a-z]{1,6})\.?\s+([ivxlcdmIVXLCDM]+|\d{1,3})\.?\s*(\d{1,3})')


def roman_to_int(s):
    s = s.lower()
    # OCR reads leading lowercase 'l' as capital 'I'; e.g. 'Ixxxix' is really 'lxxxix' (89).
    if re.match(r'^ixxx', s):
        s = 'l' + s[1:]
    if s in ROMAN_VAL: return ROMAN_VAL[s]
    vals = {'i':1,'v':5,'x':10,'l':50,'c':100,'d':500,'m':1000}
    if not all(c in vals for c in s): return None
    total = 0; prev = 0
    for c in reversed(s):
        v = vals[c]; total += -v if v < prev else v; prev = max(prev, v)
    return total or None


def extract_crossrefs(notes):
    refs = []
    text = ' '.join(notes)
    for m in CITE_RE.finditer(text):
        raw_book, raw_ch, raw_v = m.group(1), m.group(2), m.group(3)
        ord_pref = (re.match(r'^\s*([1-3])', raw_book) or [None, ''])[1] if re.match(r'^\s*([1-3])', raw_book) else ''
        base = re.sub(r'^[1-3]', '', re.sub(r'[^a-z]', '', raw_book.lower()))
        bookId = CITE_BOOK.get(base)
        if not bookId: continue
        ch = int(raw_ch) if raw_ch.isdigit() else roman_to_int(raw_ch)
        if not ch: continue
        v = int(raw_v)
        target = bookId
        if bookId in NUMBERED:
            # cited without a "1/2" (e.g. "Cor. vii. 2") → default to book 1
            target = (ord_pref or '1') + bookId
        elif bookId == 'JHN' and ord_pref:        # "i/ii/iii John" = the epistles (base JN)
            target = ord_pref + 'JN'
        refs.append({'book': target, 'chapter': ch, 'verse': v, 'raw': m.group(0).strip()})
    seen = set(); out = []
    for r in refs:
        k = (r['book'], r['chapter'], r['verse'])
        if k in seen: continue
        seen.add(k); out.append(r)
    return out


# ─── text cleanup + verse sanitation ─────────────────────────────────────────

def clean_text(t):
    t = re.sub(r'\b[\dIlOoSB]{1,4}\s+THE SHEPHERD\b', ' ', t, flags=re.I)   # OCR'd running header
    t = re.sub(r'\bTHE SHEPHERD\b', ' ', t, flags=re.I)
    t = re.sub(r'\b(FIRST|SECOND|THIRD|FOURTH|FIFTH) (VISION|MANDATE|COMMANDMENT|SIMILITUDE)\b', ' ', t)
    t = re.sub(r'\s[\*†‡]\s', ' ', t)
    t = re.sub(r'\s[fJ]\s(?=[a-z])', ' ', t)       # OCR'd dagger marker " f of" -> " of"
    t = re.sub(r'\s{2,}', ' ', t)
    t = re.sub(r'\s+([,.;:?!])', r'\1', t)
    return t.strip()


def sanitize_verses(vmap):
    """Keep the consecutive run 1..k; fold out-of-sequence tail (footnote-number false
    splits) into the last good verse and flag the chapter for review."""
    if not vmap: return {}, True
    k = 0
    while (k + 1) in vmap: k += 1
    review = False
    kept = {n: vmap[n] for n in range(1, k + 1)}
    tail = [vmap[n] for n in sorted(vmap) if n > k]
    if tail and k > 0:
        kept[k] = (kept[k] + ' ' + ' '.join(tail)).strip(); review = True
    if k == 0:
        kept = {1: ' '.join(vmap.values())}; review = True
    if any(len(t) > 1200 for t in kept.values()): review = True
    return kept, review


# ─── assembly ────────────────────────────────────────────────────────────────

BOOK_BY_TYPE = {'VISION': 'HER_VIS', 'MANDATE': 'HER_MAN', 'SIMILITUDE': 'HER_SIM'}
SECNAME = {'VISION': 'Vision', 'MANDATE': 'Mandate', 'SIMILITUDE': 'Similitude'}


def assemble(secs, order, verses, crossrefs, secmap):
    flat = {}
    for s in sorted(secs, key=lambda x: (order.index(x['type']), x['num'])):
        bookId = BOOK_BY_TYPE[s['type']]
        flat.setdefault(bookId, 0)
        secmap.setdefault(bookId, [])
        chapters_flat = []
        for ch in sorted(s['chapters']):
            flat[bookId] += 1; fc = flat[bookId]
            chapters_flat.append(fc)
            clean, review = sanitize_verses(split_verses(s['chapters'][ch]['body']))
            for vn, txt in clean.items():
                verses.append({'book_id': bookId, 'chapter': fc, 'verse_num': vn,
                               'text': clean_text(txt), 'review': review})
            for cr in extract_crossrefs(s['chapters'][ch]['notes']):
                crossrefs.append({**cr, 'from_book': bookId, 'from_chapter': fc})
        secmap[bookId].append({'sectionName': f"{SECNAME[s['type']]} {s['num']}",
                               'sectionNum': s['num'], 'chapters': chapters_flat})


def build_db(verses, crossrefs, secmap):
    if os.path.exists(DB_PATH): os.remove(DB_PATH)
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE books (id TEXT PRIMARY KEY, name TEXT, short_name TEXT, testament TEXT, chapters_count INTEGER);
        CREATE TABLE verses (id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT, chapter INTEGER,
            verse_num INTEGER, text TEXT, UNIQUE(book_id, chapter, verse_num));
        CREATE INDEX idx_verses_ref ON verses(book_id, chapter);
        CREATE VIRTUAL TABLE verses_fts USING fts5(text, book_id UNINDEXED, chapter UNINDEXED,
            verse_num UNINDEXED, content=verses, content_rowid=id);
        CREATE TRIGGER verses_ai AFTER INSERT ON verses BEGIN
            INSERT INTO verses_fts(rowid, text, book_id, chapter, verse_num)
            VALUES (new.id, new.text, new.book_id, new.chapter, new.verse_num);
        END;
        CREATE TABLE crossrefs (id INTEGER PRIMARY KEY AUTOINCREMENT, from_book TEXT, from_chapter INTEGER,
            from_verse INTEGER, to_book TEXT, to_chapter INTEGER, to_verse INTEGER, raw TEXT);
        CREATE INDEX idx_crossrefs_ref ON crossrefs(from_book, from_chapter);
    """)
    counts = {k: sum(len(s['chapters']) for s in v) for k, v in secmap.items()}
    db.executemany("INSERT INTO books VALUES (?,?,?,?,?)", [
        ('HER_VIS', 'Shepherd of Hermas — Visions',     'Hermas: Vis.', 'Pseudepigrapha', counts['HER_VIS']),
        ('HER_MAN', 'Shepherd of Hermas — Mandates',    'Hermas: Man.', 'Pseudepigrapha', counts['HER_MAN']),
        ('HER_SIM', 'Shepherd of Hermas — Similitudes', 'Hermas: Sim.', 'Pseudepigrapha', counts['HER_SIM']),
    ])
    db.executemany("INSERT INTO verses(book_id,chapter,verse_num,text) VALUES (:book_id,:chapter,:verse_num,:text)", verses)
    db.executemany("INSERT INTO crossrefs(from_book,from_chapter,from_verse,to_book,to_chapter,to_verse,raw) "
                   "VALUES (:from_book,:from_chapter,0,:book,:chapter,:verse,:raw)", crossrefs)
    db.commit()
    return counts


def main():
    for p in (SOURCE_VIS_MAN, SOURCE_SIM):
        if not os.path.exists(p):
            raise SystemExit(f"Missing source file: {p}\nSee the module docstring for how to obtain it.")
    verses, crossrefs, secmap = [], [], {}
    assemble(parse(SOURCE_VIS_MAN, {'VISION', 'MANDATE'}), ['VISION', 'MANDATE'], verses, crossrefs, secmap)
    assemble(parse(SOURCE_SIM, {'SIMILITUDE'}), ['SIMILITUDE'], verses, crossrefs, secmap)
    counts = build_db(verses, crossrefs, secmap)
    flagged = sorted({(x['book_id'], x['chapter']) for x in verses if x['review']})
    print(f"wrote {DB_PATH}")
    print(f"  verses={len(verses)}  crossrefs={len(crossrefs)}  flagged-for-review chapters={len(flagged)}")
    print(f"  chapters per book: {counts}")
    print("  NOTE: best-effort OCR — flagged chapters need human proofreading.")


if __name__ == '__main__':
    main()

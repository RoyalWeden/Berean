#!/usr/bin/env python3
"""
scripts/audit_lxx_brenton_alignment.py

Audits data/lxx_brenton.db's text_tagged column for likely word<->Strong's-number
misalignment. Unlike audit_lxx_completeness.py (which checks verse/chapter
COVERAGE against the ebible.org source), this checks the QUALITY of the Brenton
English <-> Greek Strong's-number alignment that build_lxx_brenton_strongs.py
already wrote — there's no ground-truth interlinear for Brenton, so that script
has to guess via gloss-keyword matching (see its Pass 1 / Pass 2 comments), and
some of those guesses are wrong.

Method: for every tagged word in the DB, reproduce the same gloss/stem/prefix
comparison build_lxx_brenton_strongs.py used to decide the assignment (reusing
its own variants()/stem()/kw_from_def()/kw_from_def_raw() functions directly,
so the audit's notion of "confidence" matches the real heuristic exactly) and
classify it:

  exact  — the English word (or an irregular-verb base) appears verbatim in the
           G-number's short_def keyword set. Highest confidence.
  stem   — only a stemmed form matches. Still solid.
  prefix — only a 4-character prefix matches (Pass 1's weakest positive score).
           Worth a second look on anything unusual.
  none   — no gloss overlap of ANY kind between the English word and its
           assigned G-number's short_def. This is exactly Pass 2's "ordered
           leftover fallback" case (a blind position-based pairing within a
           bounded window) OR a genuine case where Brenton's word choice just
           doesn't share vocabulary with the Strong's short_def — can't tell
           which from the tag alone, so these are the ones worth a human look.

Read-only — makes no changes to the database.

Usage:
  python3 scripts/audit_lxx_brenton_alignment.py                # full scan, summary + flagged report
  python3 scripts/audit_lxx_brenton_alignment.py --book PSA      # limit to one book (DB book_id)
  python3 scripts/audit_lxx_brenton_alignment.py --max-flagged 40  # cap detail lines per book (default 25)
  python3 scripts/audit_lxx_brenton_alignment.py --out report.txt  # also write the full flagged list to a file
"""
import argparse
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_lxx_brenton_strongs as blbs  # noqa: E402  (reuse its exact matching logic)

BRENTON_DB = Path(__file__).parent.parent / 'data' / 'lxx_brenton.db'
STRONGS_DB = Path(__file__).parent.parent / 'data' / 'strongs_greek.db'

WORD_RE = re.compile(r"^[^A-Za-z']*([A-Za-z'][A-Za-z'-]*)[^A-Za-z'-]*$")


def parse_tagged(tagged: str) -> list[tuple[str, str]]:
    """'In{G1722} the{} beginning{G746}' -> [('In','G1722'), ('the',''), ...]"""
    out = []
    for tok in tagged.split():
        m = re.match(r'^(.+?)\{(G\d*)\}$', tok)
        out.append((m.group(1), m.group(2)) if m else (tok, ''))
    return out


def classify(word: str, gnum: str, def_dict: dict, raw_def_dict: dict) -> str:
    m = WORD_RE.match(word)
    clean = m.group(1).lower() if m else ''
    if not clean:
        return 'skip'  # pure punctuation token, nothing to classify

    vs = blbs.variants(clean)
    vs_stems = {blbs.stem(v) for v in vs}
    kw = def_dict.get(gnum, set())
    kw_raw = raw_def_dict.get(gnum, set())
    kw_stems = {blbs.stem(k) for k in kw}
    kw_raw_stems = {blbs.stem(k) for k in kw_raw}

    if vs & kw or vs & kw_raw:
        return 'exact'
    if vs_stems & kw_stems or vs_stems & kw_raw_stems:
        return 'stem'
    if len(clean) >= 4 and any(
            v[:4] == k[:4] for v in vs for k in (kw | kw_raw)
            if len(v) >= 4 and len(k) >= 4):
        return 'prefix'
    return 'none'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--book', help='limit to one DB book_id (e.g. PSA, GEN)')
    ap.add_argument('--max-flagged', type=int, default=25,
                     help='max "none"-confidence lines to print per book (default 25)')
    ap.add_argument('--out', help='also write the full flagged list to this file')
    args = ap.parse_args()

    brenton_db = sqlite3.connect(str(BRENTON_DB))
    strongs_db = sqlite3.connect(str(STRONGS_DB))

    print('Building definition dictionary …')
    def_dict: dict[str, set] = {}
    raw_def_dict: dict[str, set] = {}
    for gnum, short_def in strongs_db.execute(
            'SELECT strongs_id, short_def FROM entries').fetchall():
        def_dict[gnum] = blbs.kw_from_def(short_def or '')
        raw_def_dict[gnum] = blbs.kw_from_def_raw(short_def or '')

    books = {row[0]: row[1] for row in brenton_db.execute('SELECT id, name FROM books')}

    query = ("SELECT book_id, chapter, verse_num, text_tagged FROM verses "
             "WHERE text_tagged IS NOT NULL AND text_tagged != ''")
    params: tuple = ()
    if args.book:
        query += ' AND book_id = ?'
        params = (args.book,)
    query += ' ORDER BY book_id, chapter, verse_num'

    counts = Counter()
    per_book_counts: dict[str, Counter] = defaultdict(Counter)
    flagged: list[tuple[str, int, int, str, str, str]] = []  # book, ch, vs, word, gnum, short_def

    print('Scanning tagged verses …')
    n_verses = 0
    for bid, ch, vs, tagged in brenton_db.execute(query, params):
        n_verses += 1
        for word, gnum in parse_tagged(tagged):
            if not gnum:
                counts['empty'] += 1
                per_book_counts[bid]['empty'] += 1
                continue
            bucket = classify(word, gnum, def_dict, raw_def_dict)
            if bucket == 'skip':
                continue
            counts[bucket] += 1
            per_book_counts[bid][bucket] += 1
            if bucket == 'none':
                short_def = strongs_db.execute(
                    'SELECT short_def FROM entries WHERE strongs_id = ?', (gnum,)
                ).fetchone()
                flagged.append((bid, ch, vs, word, gnum, (short_def or [''])[0]))

    total_words = sum(counts.values())
    print(f'\n=== Overall ({n_verses} verses, {total_words} tagged word-slots) ===')
    for bucket in ('exact', 'stem', 'prefix', 'none', 'empty'):
        n = counts[bucket]
        pct = 100 * n / total_words if total_words else 0
        print(f'  {bucket:8s} {n:6d}  ({pct:4.1f}%)')

    flagged_pct = 100 * counts['none'] / total_words if total_words else 0
    print(f'\n"none"-confidence rate: {flagged_pct:.1f}% of all tagged word-slots — '
          f'these are the ones most likely to be a real Pass-2 blind-fallback '
          f'misalignment rather than a genuine no-shared-vocabulary match.')

    print('\n=== Per-book "none" rate (worst first) ===')
    book_rates = []
    for bid, c in per_book_counts.items():
        tot = sum(c.values())
        rate = 100 * c['none'] / tot if tot else 0
        book_rates.append((rate, bid, c['none'], tot))
    for rate, bid, n_none, tot in sorted(book_rates, reverse=True):
        print(f'  {books.get(bid, bid):20s} {rate:5.1f}%  ({n_none}/{tot})')

    print(f'\n=== Flagged words (up to {args.max_flagged} per book) — spot-check these ===')
    by_book: dict[str, list] = defaultdict(list)
    for row in flagged:
        by_book[row[0]].append(row)

    out_lines = []
    for bid in sorted(by_book):
        rows = by_book[bid]
        print(f'\n-- {books.get(bid, bid)} ({len(rows)} flagged) --')
        for bid_, ch, vs, word, gnum, short_def in rows[:args.max_flagged]:
            line = f'  {bid_} {ch}:{vs}  {word!r} -> {gnum}  ("{short_def}")'
            print(line)
        if len(rows) > args.max_flagged:
            print(f'  … and {len(rows) - args.max_flagged} more')
        out_lines.append(f'-- {books.get(bid, bid)} ({len(rows)} flagged) --')
        for bid_, ch, vs, word, gnum, short_def in rows:
            out_lines.append(f'  {bid_} {ch}:{vs}  {word!r} -> {gnum}  ("{short_def}")')

    if args.out:
        Path(args.out).write_text('\n'.join(out_lines) + '\n')
        print(f'\nFull flagged list ({len(flagged)} rows) written to {args.out}')

    brenton_db.close()
    strongs_db.close()


if __name__ == '__main__':
    main()

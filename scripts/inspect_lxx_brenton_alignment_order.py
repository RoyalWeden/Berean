#!/usr/bin/env python3
"""
scripts/inspect_lxx_brenton_alignment_order.py

A DIFFERENT, more direct check than audit_lxx_brenton_alignment.py's gloss-overlap
classification (which flags "no shared vocabulary" — but Gen 1:2's "moved" -> G2018
proves that's not the same thing as "misaligned": ἐπιφέρω/G2018 genuinely IS the verb
there, it just doesn't share English words with its own short_def). This script
instead reconstructs, for each English word's assigned G-number, WHICH occurrence of
that G-number in the verse's actual Greek word order it must correspond to (earliest
not-yet-consumed occurrence, since the aligner marks Greek tokens "used" without
replacement) and checks whether that position ever jumps BACKWARD as we walk the
English sentence left to right. Real translation reordering happens in small local
swaps (a two-to-three-word hyperbaton); a LARGE backward jump is a much stronger,
gloss-independent signal of true misalignment than "no keyword overlap."

Usage:
  python3 scripts/inspect_lxx_brenton_alignment_order.py                  # full-corpus summary
  python3 scripts/inspect_lxx_brenton_alignment_order.py --book PSA       # one book
  python3 scripts/inspect_lxx_brenton_alignment_order.py --min-jump 4 --sample 25 --print

Read-only.
"""
import argparse
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

BRENTON_DB = Path(__file__).parent.parent / 'data' / 'lxx_brenton.db'
LXX_DB = Path(__file__).parent.parent / 'data' / 'lxx.db'


def parse_tagged(tagged: str) -> list[tuple[str, str]]:
    out = []
    for tok in tagged.split():
        m = re.match(r'^(.+?)\{(G\d*)\}$', tok)
        out.append((m.group(1), m.group(2)) if m else (tok, ''))
    return out


def worst_backward_jump(eng: list[tuple[str, str]], grk: list[tuple[str, str]]):
    """Returns (max_jump, jump_word_index, matched_indices) or None if nothing to check."""
    greek_positions: dict[str, list[int]] = defaultdict(list)
    for j, (_, g) in enumerate(grk):
        if g:
            greek_positions[g].append(j)
    next_idx: dict[str, int] = defaultdict(int)
    last_pos = -1
    max_jump = 0
    jump_at = -1
    matched: list[int | None] = []
    any_matched = False
    for i, (_, g) in enumerate(eng):
        if not g:
            matched.append(None)
            continue
        occs = greek_positions.get(g, [])
        idx_in_occs = next_idx[g]
        if idx_in_occs >= len(occs):
            # More English words tagged with this G than the Greek verse actually has —
            # a real data inconsistency (shouldn't normally happen); skip rather than guess.
            matched.append(None)
            continue
        pos = occs[idx_in_occs]
        next_idx[g] += 1
        matched.append(pos)
        any_matched = True
        if pos < last_pos:
            jump = last_pos - pos
            if jump > max_jump:
                max_jump = jump
                jump_at = i
        last_pos = max(last_pos, pos)
    if not any_matched:
        return None
    return max_jump, jump_at, matched


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--book')
    ap.add_argument('--min-jump', type=int, default=4, help='only PRINT verses with a backward jump at least this large (default 4)')
    ap.add_argument('--sample', type=int, default=25, help='max verses to print in detail (default 25)')
    ap.add_argument('--print', action='store_true', dest='do_print', help='print the worst verses side by side')
    args = ap.parse_args()

    brenton_db = sqlite3.connect(str(BRENTON_DB))
    lxx_db = sqlite3.connect(str(LXX_DB))

    rahlfs: dict[tuple[str, int, int], str] = {}
    for bid, ch, vs, tagged in lxx_db.execute(
            "SELECT book_id, chapter, verse_num, text_tagged FROM verses "
            "WHERE text_tagged IS NOT NULL AND text_tagged != ''"):
        rahlfs[(bid, ch, vs)] = tagged

    books = {row[0]: row[1] for row in brenton_db.execute('SELECT id, name FROM books')}

    query = ("SELECT book_id, chapter, verse_num, text_tagged FROM verses "
             "WHERE text_tagged IS NOT NULL AND text_tagged != ''")
    params: tuple = ()
    if args.book:
        query += ' AND book_id = ?'
        params = (args.book,)
    query += ' ORDER BY book_id, chapter, verse_num'

    n_verses = 0
    n_checked = 0
    jump_hist: dict[int, int] = defaultdict(int)  # bucketed max-jump -> count of verses
    per_book_checked: dict[str, int] = defaultdict(int)
    per_book_bad: dict[str, int] = defaultdict(int)  # max_jump >= min-jump
    worst: list[tuple[int, str, int, int, str, str]] = []  # (jump, bid, ch, vs, eng_tagged, grk_tagged)

    for bid, ch, vs, eng_tagged in brenton_db.execute(query, params):
        n_verses += 1
        grk_tagged = rahlfs.get((bid, ch, vs))
        if not grk_tagged:
            continue
        eng = parse_tagged(eng_tagged)
        grk = parse_tagged(grk_tagged)
        result = worst_backward_jump(eng, grk)
        if result is None:
            continue
        n_checked += 1
        per_book_checked[bid] += 1
        max_jump, _, _ = result
        bucket = 0 if max_jump == 0 else (1 if max_jump < 2 else (2 if max_jump < 4 else (4 if max_jump < 8 else 8)))
        jump_hist[bucket] += 1
        if max_jump >= args.min_jump:
            per_book_bad[bid] += 1
            worst.append((max_jump, bid, ch, vs, eng_tagged, grk_tagged))

    print(f'=== Overall: {n_checked}/{n_verses} verses checked (has matching Rahlfs Greek row) ===')
    labels = {0: 'perfectly in order (jump=0)', 1: 'jump 1', 2: 'jump 2-3', 4: 'jump 4-7', 8: 'jump 8+'}
    for b in (0, 1, 2, 4, 8):
        n = jump_hist[b]
        pct = 100 * n / n_checked if n_checked else 0
        print(f'  {labels[b]:28s} {n:6d}  ({pct:4.1f}%)')

    print(f'\n=== Per-book rate of verses with jump >= {args.min_jump} (worst first) ===')
    rates = []
    for bid, checked in per_book_checked.items():
        bad = per_book_bad.get(bid, 0)
        rates.append((100 * bad / checked if checked else 0, bid, bad, checked))
    for rate, bid, bad, checked in sorted(rates, reverse=True)[:30]:
        print(f'  {books.get(bid, bid):20s} {rate:5.1f}%  ({bad}/{checked})')

    worst.sort(key=lambda r: -r[0])
    print(f'\n=== {len(worst)} verses with jump >= {args.min_jump} total; showing up to {args.sample} worst ===')
    for max_jump, bid, ch, vs, eng_tagged, grk_tagged in worst[:args.sample]:
        print(f'\n-- {books.get(bid, bid)} {ch}:{vs}  (max backward jump: {max_jump}) --')
        if args.do_print:
            print(f'  EN: {eng_tagged}')
            print(f'  GR: {grk_tagged}')

    brenton_db.close()
    lxx_db.close()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
scripts/preview_lxx_brenton_realign.py

Dry-runs build_lxx_brenton_strongs.py's align() over the WHOLE corpus WITHOUT writing
anything to lxx_brenton.db, and reports how the result would differ from what's
currently stored. Exists specifically because a previous attempt at improving the
alignment algorithm looked fine on a handful of spot-checked verses, was written to the
live database (worktrees symlink data/*.db back to the main tree — this is NOT an
isolated copy), and only THEN was found to have broken the ubiquitous Greek
verb-before-subject word order (untagging "made" in Gen 1:1). Never run
build_lxx_brenton_strongs.py's main() again as a way to "try out" an algorithm change —
run this first, on the CURRENTLY STORED data, and only run the real build once this
looks right.

Reports, comparing the CURRENT database's text_tagged (`--book` optional) against what
align() would now produce:
  - How many tags changed at all, and how many of those changes REMOVED a tag that used
    to be present (the riskiest kind of change to review).
  - inspect_lxx_brenton_alignment_order.py's own backward-jump distribution, OLD vs NEW,
    so an improvement is measurable in the same terms as the audit that found the problem.
  - A same spot-check list of "should never change" reference verses (Gen 1:1, 1:2, Ps
    23:1, Isa 53:1 — the same ones build_lxx_brenton_strongs.py's own main() prints) so a
    regression there is impossible to miss.
  - A sample of the words that got REMOVED, for manual review.

Read-only — makes no changes to any database.
"""
import argparse
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build_lxx_brenton_strongs as blbs  # noqa: E402
from inspect_lxx_brenton_alignment_order import parse_tagged, worst_backward_jump  # noqa: E402

BRENTON_DB = Path(__file__).parent.parent / 'data' / 'lxx_brenton.db'
LXX_DB = Path(__file__).parent.parent / 'data' / 'lxx.db'
STRONGS_DB = Path(__file__).parent.parent / 'data' / 'strongs_greek.db'

SPOT_CHECK = [('Gen 1:1', 'GEN', 1, 1), ('Gen 1:2', 'GEN', 1, 2), ('Ps 23:1', 'PSA', 23, 1), ('Isa 53:1', 'ISA', 53, 1)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--book')
    ap.add_argument('--sample-removed', type=int, default=30)
    args = ap.parse_args()

    brenton_db = sqlite3.connect(str(BRENTON_DB))
    lxx_db = sqlite3.connect(str(LXX_DB))
    strongs_db = sqlite3.connect(str(STRONGS_DB))

    print('Building definition dictionary …')
    def_dict: dict[str, set] = {}
    raw_def_dict: dict[str, set] = {}
    for gnum, short_def in strongs_db.execute('SELECT strongs_id, short_def FROM entries').fetchall():
        def_dict[gnum] = blbs.kw_from_def(short_def or '')
        raw_def_dict[gnum] = blbs.kw_from_def_raw(short_def or '')

    rahlfs: dict[tuple[str, int, int], str] = {}
    for bid, ch, vs, tagged in lxx_db.execute(
            "SELECT book_id, chapter, verse_num, text_tagged FROM verses "
            "WHERE text_tagged IS NOT NULL AND text_tagged != ''"):
        rahlfs[(bid, ch, vs)] = tagged

    books = {row[0]: row[1] for row in brenton_db.execute('SELECT id, name FROM books')}

    query = "SELECT book_id, chapter, verse_num, text, text_tagged FROM verses WHERE text_tagged IS NOT NULL AND text_tagged != ''"
    params: tuple = ()
    if args.book:
        query += ' AND book_id = ?'
        params = (args.book,)
    query += ' ORDER BY book_id, chapter, verse_num'

    n_verses = 0
    n_changed = 0
    n_word_removed = 0
    n_word_added = 0
    n_word_changed_value = 0
    old_jump_hist: dict[int, int] = defaultdict(int)
    new_jump_hist: dict[int, int] = defaultdict(int)
    removed_samples: list[tuple[str, int, int, str, str]] = []

    def bucket(j: int) -> int:
        return 0 if j == 0 else (1 if j < 2 else (2 if j < 4 else (4 if j < 8 else 8)))

    for bid, ch, vs, text, old_tagged in brenton_db.execute(query, params):
        grk_tagged = rahlfs.get((bid, ch, vs))
        if not grk_tagged:
            continue
        n_verses += 1
        gt = blbs.parse_rahlfs(grk_tagged)
        new_tagged = blbs.align(gt, text, def_dict, raw_def_dict)

        old_words = parse_tagged(old_tagged)
        new_words = parse_tagged(new_tagged)
        if old_tagged != new_tagged:
            n_changed += 1
            for (ow, og), (nw, ng) in zip(old_words, new_words):
                if og == ng:
                    continue
                if og and not ng:
                    n_word_removed += 1
                    if len(removed_samples) < args.sample_removed * 3:
                        removed_samples.append((bid, ch, vs, ow, og))
                elif not og and ng:
                    n_word_added += 1
                else:
                    n_word_changed_value += 1

        old_r = worst_backward_jump(old_words, gt)
        new_r = worst_backward_jump(new_words, gt)
        if old_r:
            old_jump_hist[bucket(old_r[0])] += 1
        if new_r:
            new_jump_hist[bucket(new_r[0])] += 1

    print(f'\n=== {n_verses} verses compared, {n_changed} changed ({100*n_changed/n_verses:.1f}%) ===')
    print(f'  words REMOVED (had a tag, now none):  {n_word_removed}')
    print(f'  words ADDED (had none, now tagged):   {n_word_added}')
    print(f'  words CHANGED (tag -> different tag): {n_word_changed_value}')

    labels = {0: 'perfectly in order (jump=0)', 1: 'jump 1', 2: 'jump 2-3', 4: 'jump 4-7', 8: 'jump 8+'}
    print('\n=== Backward-jump distribution: OLD -> NEW ===')
    for b in (0, 1, 2, 4, 8):
        old_n, new_n = old_jump_hist[b], new_jump_hist[b]
        old_pct = 100 * old_n / n_verses if n_verses else 0
        new_pct = 100 * new_n / n_verses if n_verses else 0
        print(f'  {labels[b]:28s} {old_n:6d} ({old_pct:4.1f}%)  ->  {new_n:6d} ({new_pct:4.1f}%)')

    print('\n=== Spot-check (must be unaffected by any real fix) ===')
    for ref, bid, ch, vs in SPOT_CHECK:
        row = brenton_db.execute('SELECT text FROM verses WHERE book_id=? AND chapter=? AND verse_num=?', (bid, ch, vs)).fetchone()
        grk_tagged = rahlfs.get((bid, ch, vs))
        if not row or not grk_tagged:
            continue
        gt = blbs.parse_rahlfs(grk_tagged)
        new_tagged = blbs.align(gt, row[0], def_dict, raw_def_dict)
        print(f'  {ref}: {new_tagged[:110]}')

    if removed_samples:
        print(f'\n=== Sample of removed tags (up to {args.sample_removed}) ===')
        for bid, ch, vs, word, gnum in removed_samples[:args.sample_removed]:
            print(f'  {books.get(bid, bid)} {ch}:{vs}  {word!r} lost {gnum}')

    brenton_db.close()
    lxx_db.close()
    strongs_db.close()


if __name__ == '__main__':
    main()

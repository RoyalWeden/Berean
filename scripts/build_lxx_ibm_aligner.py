#!/usr/bin/env python3
"""
scripts/build_lxx_ibm_aligner.py

Uses the trained IBM Model 1 tables (train_ibm_model1.py — run that first) to produce
an ALTERNATIVE text_tagged alignment for every Brenton verse, completely independent
of build_lxx_brenton_strongs.py's gloss-keyword heuristic. This is a genuinely
different method (statistical co-occurrence learned across the whole corpus, not
single-verse dictionary matching), not a tweak to the existing one.

For each verse, for each English word, scores every Greek word ACTUALLY PRESENT in
that verse (never the whole vocabulary — this is per-verse local competition, same
idea as the heuristic's own windowing) as:

    score(e, f) = t_fwd(e|f) * t_rev(f|e)

Combining both directions suppresses IBM Model 1's well-known "garbage collection"
problem (a very frequent English word — he/the/and — can look like a good top
"translation" for many different Greek words in the FORWARD table alone, purely by
co-occurring with almost everything; the REVERSE direction doesn't share that bias,
since from a specific Greek word's own side, dozens of other candidates compete just
as well for a frequent English word). Selection is greedy-by-score per verse (highest
combined score first, each side used at most once), the exact same "resolve most
severe crossings, never invent a new wrong pairing" post-process
build_lxx_brenton_strongs.py already uses is applied here too (see
select_with_severe_crossing_guard below — deliberately duplicated rather than
imported, so this file stays a fully independent, comparable alternative).

This is DIAGNOSTIC/COMPARISON ONLY by default (--preview, the default) — it never
writes to lxx_brenton.db. Only with --write does it touch the database, and even
then only after you've reviewed the preview's comparison against the current
heuristic (same "validate before touching the live database" discipline as
preview_lxx_brenton_realign.py — see that script's own warning about why).

Usage:
  python3 scripts/build_lxx_ibm_aligner.py                  # preview only, whole corpus
  python3 scripts/build_lxx_ibm_aligner.py --book GEN
  python3 scripts/build_lxx_ibm_aligner.py --write           # actually writes text_tagged
"""
import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from inspect_lxx_brenton_alignment_order import parse_tagged, worst_backward_jump  # noqa: E402

BRENTON_DB = Path(__file__).parent.parent / 'data' / 'lxx_brenton.db'
LXX_DB = Path(__file__).parent.parent / 'data' / 'lxx.db'
FWD_PATH = Path(__file__).parent / 'ibm_model1_table.json'
REV_PATH = Path(__file__).parent / 'ibm_model1_table_reverse.json'
NULL_TOKEN = '\x00NULL'

WORD_RE = re.compile(r"^[^A-Za-z']*([A-Za-z'][A-Za-z'-]*)[^A-Za-z'-]*$")
MIN_SCORE = 1e-6  # below this, treat as "no real correspondence" and leave untagged
SEVERE_JUMP_SLACK = 8  # same value/reasoning as build_lxx_brenton_strongs.py's post-process


def parse_rahlfs(tagged: str) -> list[tuple[str, str]]:
    out = []
    for tok in tagged.split():
        m = re.match(r'^(.+?)\{(G\d*)\}$', tok)
        out.append((m.group(1), m.group(2)) if m else (tok, ''))
    return out


def align_verse(english_text: str, greek_tokens: list[tuple[str, str]],
                 t_fwd: dict, t_rev: dict) -> str:
    raw = english_text.split()
    parsed: list[tuple[str, str]] = []
    for tok in raw:
        m = WORD_RE.match(tok)
        parsed.append((tok, m.group(1).lower() if m else ''))

    if not greek_tokens:
        return ' '.join(f"{orig}{{}}" for orig, _ in parsed)

    cand: list[tuple[float, int, int, str]] = []
    for i, (orig, clean) in enumerate(parsed):
        if not clean:
            continue
        for j, (gw, gs) in enumerate(greek_tokens):
            if not gs:
                continue
            f = gw.lower()
            fwd = t_fwd.get(f, {}).get(clean, 0.0)
            rev = t_rev.get(clean, {}).get(f, 0.0)
            score = fwd * rev
            if score > MIN_SCORE:
                cand.append((score, i, j, gs))

    cand.sort(reverse=True)
    assignments: dict[int, str] = {}
    assign_j: dict[int, int] = {}
    assign_score: dict[int, float] = {}
    greek_used: set[int] = set()
    for score, i, j, gs in cand:
        if i not in assignments and j not in greek_used:
            assignments[i] = gs
            assign_j[i] = j
            assign_score[i] = score
            greek_used.add(j)

    # Same severe-backward-crossing guard as build_lxx_brenton_strongs.py — only ever removes
    # a tag (never reassigns), and only past a generous slack, so ordinary local Greek/English
    # reordering (verb-before-subject etc.) is unaffected.
    items = sorted(assign_j.items())
    kept = {i: True for i, _ in items}
    for pos, (i, j) in enumerate(items):
        max_j, max_i = -1, None
        for k in range(pos):
            ii, jj = items[k]
            if kept[ii] and jj > max_j:
                max_j, max_i = jj, ii
        if max_i is not None and j < max_j - SEVERE_JUMP_SLACK:
            if assign_score.get(i, 0.0) >= assign_score.get(max_i, 0.0):
                kept[max_i] = False
            else:
                kept[i] = False
    for i, _ in items:
        if not kept[i]:
            assignments.pop(i, None)

    return ' '.join(f"{orig}{{{assignments.get(i, '')}}}" for i, (orig, _) in enumerate(parsed))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--book')
    ap.add_argument('--write', action='store_true', help='actually write text_tagged (default: preview only)')
    ap.add_argument('--sample-removed', type=int, default=0)
    args = ap.parse_args()

    print('Loading IBM Model 1 tables …')
    with open(FWD_PATH, encoding='utf-8') as f:
        t_fwd = json.load(f)
    with open(REV_PATH, encoding='utf-8') as f:
        t_rev = json.load(f)

    brenton_db = sqlite3.connect(str(BRENTON_DB))
    lxx_db = sqlite3.connect(str(LXX_DB))
    rahlfs: dict[tuple[str, int, int], str] = {}
    for bid, ch, vs, tagged in lxx_db.execute(
            "SELECT book_id, chapter, verse_num, text_tagged FROM verses "
            "WHERE text_tagged IS NOT NULL AND text_tagged != ''"):
        rahlfs[(bid, ch, vs)] = tagged

    query = "SELECT id, book_id, chapter, verse_num, text, text_tagged FROM verses WHERE text_tagged IS NOT NULL AND text_tagged != ''"
    params: tuple = ()
    if args.book:
        query += ' AND book_id = ?'
        params = (args.book,)
    query += ' ORDER BY id'

    n_verses = n_changed = n_removed = n_added = n_changed_val = 0
    old_hist: dict[int, int] = {}
    new_hist: dict[int, int] = {}
    updates: list[tuple[str, int]] = []

    def bucket(j: int) -> int:
        return 0 if j == 0 else (1 if j < 2 else (2 if j < 4 else (4 if j < 8 else 8)))

    for vid, bid, ch, vs, text, old_tagged in brenton_db.execute(query, params):
        grk_tagged = rahlfs.get((bid, ch, vs))
        if not grk_tagged:
            continue
        n_verses += 1
        gt = parse_rahlfs(grk_tagged)
        new_tagged = align_verse(text, gt, t_fwd, t_rev)
        updates.append((new_tagged, vid))

        old_words = parse_tagged(old_tagged)
        new_words = parse_tagged(new_tagged)
        if old_tagged != new_tagged:
            n_changed += 1
            for (ow, og), (nw, ng) in zip(old_words, new_words):
                if og == ng:
                    continue
                if og and not ng:
                    n_removed += 1
                elif not og and ng:
                    n_added += 1
                else:
                    n_changed_val += 1

        old_r = worst_backward_jump(old_words, gt)
        new_r = worst_backward_jump(new_words, gt)
        if old_r:
            old_hist[bucket(old_r[0])] = old_hist.get(bucket(old_r[0]), 0) + 1
        if new_r:
            new_hist[bucket(new_r[0])] = new_hist.get(bucket(new_r[0]), 0) + 1

    print(f'\n=== {n_verses} verses, {n_changed} changed vs. current heuristic ({100*n_changed/n_verses:.1f}%) ===')
    print(f'  words removed (had tag, now none):     {n_removed}')
    print(f'  words added (had none, now tagged):    {n_added}')
    print(f'  words changed to a DIFFERENT tag:      {n_changed_val}')

    labels = {0: 'perfectly in order (jump=0)', 1: 'jump 1', 2: 'jump 2-3', 4: 'jump 4-7', 8: 'jump 8+'}
    print('\n=== Backward-jump distribution: current heuristic -> IBM Model 1 ===')
    for b in (0, 1, 2, 4, 8):
        o, n = old_hist.get(b, 0), new_hist.get(b, 0)
        print(f'  {labels[b]:28s} {o:6d} ({100*o/n_verses:4.1f}%)  ->  {n:6d} ({100*n/n_verses:4.1f}%)')

    print('\n=== Spot-check ===')
    for ref, bid, ch, vs in [('Gen 1:1', 'GEN', 1, 1), ('Gen 1:2', 'GEN', 1, 2), ('Ps 23:1', 'PSA', 23, 1), ('Isa 53:1', 'ISA', 53, 1)]:
        row = brenton_db.execute('SELECT text FROM verses WHERE book_id=? AND chapter=? AND verse_num=?', (bid, ch, vs)).fetchone()
        grk = rahlfs.get((bid, ch, vs))
        if not row or not grk:
            continue
        print(f'  {ref}: {align_verse(row[0], parse_rahlfs(grk), t_fwd, t_rev)[:120]}')

    if args.write:
        print(f'\nWriting {len(updates)} rows to lxx_brenton.db …')
        brenton_db.executemany('UPDATE verses SET text_tagged = ? WHERE id = ?', updates)
        brenton_db.commit()
        print('Done.')
    else:
        print('\n(preview only — pass --write to actually update the database)')

    brenton_db.close()
    lxx_db.close()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
extract_psalm_titles.py — provenance for src/lib/psalmTitles.ts

Source of truth: /Users/roywe/Downloads/kjv+.bbli
    A SQLite DB ("KJV with Strong's Numbers"): tables Details, Bible(Book,Chapter,Verse,Scripture).
    Book 19 = Psalms.

In each Psalm's verse-1 Scripture string the KJV superscription (psalm title) words are
wrapped in <b>...</b> spans at the very start of the string, e.g.:

    <b>To the chief Musician,</b><num>H5329</num> <b>A Psalm</b><num>H4210</num> <b>of David,</b> ... Have mercy upon me ...

The concatenation, in order, space-joined and whitespace-normalized, of the LEADING run of
<b>...</b> spans (allowing <num>...</num> / <sup>...</sup> / whitespace between them) IS that
Psalm's superscription. Inner <i>...</i> (and any other) tags are stripped. A Psalm whose
verse 1 begins directly with body text (no leading <b> span) has no superscription.

Outputs (stdout): the PSALM_TITLES_KJV object body for pasting/among-diffing, plus a
verification block comparing against data/kjva.db text_tagged prefixes.
"""

import re
import sqlite3
import sys
from pathlib import Path

BBLI = Path("/Users/roywe/Downloads/kjv+.bbli")
DATA = Path(__file__).resolve().parent.parent / "data"
KJVA = DATA / "kjva.db"
KJV = DATA / "kjv.db"
BRENTON = DATA / "lxx_brenton.db"

# ---------------------------------------------------------------------------
# Brenton LXX title-verse classification (curated after printing v1 + v2 of all
# 150 Psalms and hand-reviewing every boundary case). See src/lib/psalmTitles.ts.
#   value 1 = verse 1 is entirely superscription, body starts v2
#   value 2 = verses 1 AND 2 are superscription (v2 is a "when ..." note), body v3
# Psalms absent here EITHER have no LXX superscription (Ps 1, 2) OR carry the title
# INLINE at the head of verse 1 with body following on the same verse (see
# BRENTON_INLINE_IN_V1 — renderer strips a text prefix, not a whole verse).
BRENTON_TITLE_VERSE_COUNT = {
    3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 11: 1, 12: 1, 17: 1, 18: 1, 19: 1,
    20: 1, 21: 1, 29: 1, 30: 1, 33: 1, 35: 1, 37: 1, 38: 1, 39: 1, 40: 1, 41: 1,
    43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 48: 1, 50: 2, 51: 2, 52: 1, 53: 2, 54: 1,
    55: 1, 56: 1, 57: 1, 58: 1, 59: 2, 60: 1, 61: 1, 62: 1, 63: 1, 64: 1, 66: 1,
    67: 1, 68: 1, 69: 1, 74: 1, 75: 1, 76: 1, 79: 1, 80: 1, 82: 1, 83: 1, 84: 1,
    87: 1, 88: 1, 91: 1, 101: 1, 107: 1, 139: 1, 141: 1,
}
BRENTON_INLINE_IN_V1 = [
    10, 13, 14, 15, 16, 22, 23, 24, 25, 26, 27, 28, 31, 32, 34, 36, 42, 49, 65, 70,
    71, 72, 73, 77, 78, 81, 85, 86, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99, 100, 102,
    103, 104, 105, 106, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
    120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
    136, 137, 138, 140, 142, 143, 144, 145, 146, 147, 148, 149, 150,
]

B_SPAN = re.compile(r"<b>(.*?)</b>", re.DOTALL)
SKIP_TAG = re.compile(r"<(num|sup)>.*?</\1>", re.DOTALL)
WS = re.compile(r"\s+")
ANY_TAG = re.compile(r"<[^>]*>")


def extract_title(scripture: str) -> str:
    """Return the leading <b>-span superscription text, or '' if none."""
    pos = 0
    s = scripture
    parts = []
    while pos < len(s):
        m = WS.match(s, pos)
        if m and m.end() > pos:
            pos = m.end()
            continue
        m = SKIP_TAG.match(s, pos)
        if m:
            pos = m.end()
            continue
        m = B_SPAN.match(s, pos)
        if m:
            inner = ANY_TAG.sub("", m.group(1))
            parts.append(inner)
            pos = m.end()
            continue
        # first non-whitespace, non-skippable, non-<b> content => body starts here
        break
    title = WS.sub(" ", " ".join(parts)).strip()
    return title


def strip_tagged(text_tagged: str) -> str:
    """kjva text_tagged -> plain text: drop {Hxxxx}/{Gxxxx}/{} braces and * ! markers."""
    if not text_tagged:
        return ""
    t = re.sub(r"\{[^}]*\}", "", text_tagged)
    t = t.replace("*", "").replace("!", "")
    t = WS.sub(" ", t).strip()
    return t


def main() -> int:
    if not BBLI.exists():
        print(f"FATAL: source file missing: {BBLI}", file=sys.stderr)
        return 2

    con = sqlite3.connect(f"file:{BBLI}?mode=ro", uri=True)
    rows = dict(
        con.execute(
            "SELECT Chapter, Scripture FROM Bible WHERE Book = 19 AND Verse = 1"
        ).fetchall()
    )
    con.close()

    if len(rows) != 150:
        print(f"WARNING: expected 150 Psalm verse-1 rows, got {len(rows)}", file=sys.stderr)

    titles: dict[int, str] = {}
    for n in range(1, 151):
        t = extract_title(rows.get(n, ""))
        if t:
            titles[n] = t

    # --- emit TS object body ---
    print("// ---- PSALM_TITLES_KJV body ----")
    for n in range(1, 151):
        if n in titles:
            esc = titles[n].replace("\\", "\\\\").replace("'", "\\'")
            print(f"  {n}: '{esc}',")
    print(f"// count with title: {len(titles)}")
    print("// without title:", [n for n in range(1, 151) if n not in titles])

    # --- verify against kjva.db text_tagged prefixes ---
    print("\n// ---- verification vs data/kjva.db text_tagged ----")
    con = sqlite3.connect(f"file:{KJVA}?mode=ro", uri=True)
    tagged = dict(
        con.execute(
            "SELECT chapter, text_tagged FROM verses WHERE book_id='PSA' AND verse_num=1"
        ).fetchall()
    )
    plain_kjva = dict(
        con.execute(
            "SELECT chapter, text FROM verses WHERE book_id='PSA' AND verse_num=1"
        ).fetchall()
    )
    con.close()

    con = sqlite3.connect(f"file:{KJV}?mode=ro", uri=True)
    plain_kjv = dict(
        con.execute(
            "SELECT chapter, text FROM verses WHERE book_id='PSA' AND verse_num=1"
        ).fetchall()
    )
    con.close()

    corrupt = []
    mismatch = []
    plain_has_title = []
    for n in range(1, 151):
        tt = strip_tagged(tagged.get(n, ""))
        if re.search(r"<\/?[a-z]|\bb>\{", tagged.get(n, "") or ""):
            corrupt.append(n)
        title = titles.get(n, "")
        if title:
            # tagged prefix should start with the title (allow trailing punctuation drift)
            norm_t = title.rstrip(".,").lower()
            if not tt.lower().startswith(norm_t[:40]):
                mismatch.append((n, title, tt[:80]))
        # plain text (kjv & kjva) should NOT contain the title
        for label, pd in (("kjv", plain_kjv), ("kjva", plain_kjva)):
            pv = (pd.get(n, "") or "")
            if title and pv.lower().startswith(title.rstrip(".,").lower()[:20]):
                plain_has_title.append((label, n))

    print("// corrupt text_tagged Psalms:", corrupt)
    print("// title vs text_tagged prefix MISMATCHES:")
    for m in mismatch:
        print("//   Ps", m[0], "| title=", repr(m[1]), "| tagged=", repr(m[2]))
    print("// plain-text verse1 unexpectedly starts with title:", plain_has_title)

    # --- Brenton LXX: print v1 + v2 of all 150 with the curated title-verse count ---
    print("\n// ---- Brenton LXX (data/lxx_brenton.db) verse 1 + 2 of every Psalm ----")
    con = sqlite3.connect(f"file:{BRENTON}?mode=ro", uri=True)
    bv: dict[int, dict[int, str]] = {}
    for ch, vn, txt in con.execute(
        "SELECT chapter, verse_num, text FROM verses WHERE book_id='PSA' AND verse_num IN (1,2)"
    ):
        bv.setdefault(ch, {})[vn] = txt
    con.close()
    for n in range(1, 151):
        v1 = (bv.get(n, {}).get(1, "") or "").strip()
        v2 = (bv.get(n, {}).get(2, "") or "").strip()
        cnt = BRENTON_TITLE_VERSE_COUNT.get(n, 0)
        tag = "INLINE-V1" if n in BRENTON_INLINE_IN_V1 else ("NO-TITLE" if cnt == 0 else "")
        print(f"//  {n:>3} | cnt={cnt} {tag:<9} | v1: {v1[:70]}")
        print(f"//        {'':<15} | v2: {v2[:70]}")
    print("// Brenton count==2:", [n for n, c in BRENTON_TITLE_VERSE_COUNT.items() if c == 2])
    print("// Brenton count>0 total:", len(BRENTON_TITLE_VERSE_COUNT))
    print("// Brenton inline-in-v1 total:", len(BRENTON_INLINE_IN_V1))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

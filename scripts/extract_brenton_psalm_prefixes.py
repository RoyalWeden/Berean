#!/usr/bin/env python3
"""
Dump every Brenton LXX Psalm's leading verses so the superscription prefix for the
85 "inline title in verse 1" Psalms can be extracted by eye, and the 63 whole-verse
title counts can be re-verified.

Reads data/lxx_brenton.db (book_id='PSA'), READ-ONLY. Writes nothing to any .db.

Usage:  python3 scripts/extract_brenton_psalm_prefixes.py
"""
import sqlite3
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "lxx_brenton.db")

# Mirror of the three existing exports in src/lib/psalmTitles.ts -----------------
PSALM_TITLE_VERSE_COUNT_BRENTON = {
    3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 11: 1, 12: 1, 17: 1, 18: 1, 19: 1,
    20: 1, 21: 1, 29: 1, 30: 1, 33: 1, 35: 1, 37: 1, 38: 1, 39: 1, 40: 1, 41: 1,
    43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 48: 1, 50: 2, 51: 2, 52: 1, 53: 2, 54: 1,
    55: 1, 56: 1, 57: 1, 58: 1, 59: 2, 60: 1, 61: 1, 62: 1, 63: 1, 64: 1, 66: 1,
    67: 1, 68: 1, 69: 1, 74: 1, 75: 1, 76: 1, 79: 1, 80: 1, 82: 1, 83: 1, 84: 1,
    87: 1, 88: 1, 91: 1, 101: 1, 107: 1, 139: 1, 141: 1,
}

PSALMS_TITLE_INLINE_IN_V1_BRENTON = [
    10, 13, 14, 15, 16, 22, 23, 24, 25, 26, 27, 28, 31, 32, 34, 36, 42, 49, 65, 70,
    71, 72, 73, 77, 78, 81, 85, 86, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99, 100, 102,
    103, 104, 105, 106, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
    120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
    136, 137, 138, 140, 142, 143, 144, 145, 146, 147, 148, 149, 150,
]

INLINE = set(PSALMS_TITLE_INLINE_IN_V1_BRENTON)


def classify(n):
    if n in PSALM_TITLE_VERSE_COUNT_BRENTON:
        return PSALM_TITLE_VERSE_COUNT_BRENTON[n]
    if n in INLINE:
        return "INLINE"
    return 0


# Manual overrides where the first ". " is INSIDE the title clause. Value = number
# of ". " occurrences to consume before the split (1 = default first ". ").
# Determined by eyeball from the dump.
PREFIX_SPLIT_OVERRIDE = {}


def propose_prefix(v1text, n):
    """Return (prefix, residual) splitting v1 at the title/body boundary."""
    # find all ". " boundaries
    idxs = []
    start = 0
    while True:
        i = v1text.find(". ", start)
        if i == -1:
            break
        idxs.append(i)
        start = i + 2
    if not idxs:
        # maybe ends with "." and no body, or uses other punctuation
        return (v1text, "")
    k = PREFIX_SPLIT_OVERRIDE.get(n, 1)
    if k > len(idxs):
        k = len(idxs)
    cut = idxs[k - 1] + 1  # include the period, drop the space
    return (v1text[:cut], v1text[cut + 1:])


def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = {}
    for ch, vn, txt in con.execute(
        "SELECT chapter, verse_num, text FROM verses WHERE book_id='PSA' ORDER BY chapter, verse_num"
    ):
        rows.setdefault(ch, {})[vn] = txt

    print("=" * 120)
    print("FULL DUMP — all 150 Brenton Psalms")
    print("=" * 120)
    for n in range(1, 151):
        vs = rows.get(n, {})
        v1 = vs.get(1, "")
        v2 = vs.get(2, "")
        v3 = vs.get(3, "")
        cls = classify(n)
        print(f"\n--- Psalm {n}   class={cls}")
        print(f"  v1: {v1!r}")
        print(f"  v2: {v2!r}")
        if cls == 2:
            print(f"  v3 (first body): {v3!r}")
        if cls == "INLINE":
            pfx, res = propose_prefix(v1, n)
            print(f"  PREFIX : {pfx!r}")
            print(f"  RESIDUAL BODY: {res!r}")

    # ---- whole-verse re-verification --------------------------------------
    print("\n" + "=" * 120)
    print("WHOLE-VERSE COUNT RE-VERIFICATION (63 Psalms)")
    print("=" * 120)
    for n in sorted(PSALM_TITLE_VERSE_COUNT_BRENTON):
        cnt = PSALM_TITLE_VERSE_COUNT_BRENTON[n]
        vs = rows.get(n, {})
        print(f"\n--- Psalm {n}   claimed count={cnt}")
        print(f"  v1: {vs.get(1,'')!r}")
        if cnt >= 2:
            print(f"  v2: {vs.get(2,'')!r}")
            print(f"  v3 (first body): {vs.get(3,'')!r}")
        else:
            print(f"  v2 (first body): {vs.get(2,'')!r}")

    # ---- emit the TS object literal for PSALM_TITLE_PREFIX_BRENTON --------
    print("\n" + "=" * 120)
    print("TS OBJECT LITERAL  export const PSALM_TITLE_PREFIX_BRENTON")
    print("=" * 120)
    print("export const PSALM_TITLE_PREFIX_BRENTON: Record<number, string> = {")
    for n in PSALMS_TITLE_INLINE_IN_V1_BRENTON:
        v1 = rows.get(n, {}).get(1, "")
        pfx, _ = propose_prefix(v1, n)
        # TS single-quoted string: escape backslash and single quote
        esc = pfx.replace("\\", "\\\\").replace("'", "\\'")
        print(f"  {n}: '{esc}',")
    print("};")


if __name__ == "__main__":
    main()

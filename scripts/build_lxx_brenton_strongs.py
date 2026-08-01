#!/usr/bin/env python3
"""
scripts/build_lxx_brenton_strongs.py

Populates text_tagged in lxx_brenton.db by aligning Rahlfs Greek Strong's numbers
(from lxx.db) to English Brenton words using Strong's G-number definitions
(from strongs_greek.db).

Output format matches KJVA: "In{G1722} the{} beginning{G746} God{G2316} made{G4160} ..."
Empty {} = no G-number found for that word.
"""

import sqlite3
import re
from pathlib import Path

LXX_DB     = Path('data/lxx.db')
BRENTON_DB = Path('data/lxx_brenton.db')
STRONGS_DB = Path('data/strongs_greek.db')

# ── Irregular English verb forms → infinitive ─────────────────────────────────

IRREG = {
    'made':'make','gave':'give','found':'find','came':'come','went':'go',
    'brought':'bring','bought':'buy','sought':'seek','thought':'think',
    'fought':'fight','caught':'catch','taught':'teach','meant':'mean',
    'kept':'keep','slept':'sleep','crept':'creep','swept':'sweep',
    'wept':'weep','felt':'feel','knelt':'kneel','dealt':'deal',
    'leapt':'leap','dreamt':'dream','spelt':'spell','spilt':'spill',
    'learnt':'learn','burnt':'burn','dwelt':'dwell','smelt':'smell',
    'bent':'bend','lent':'lend','rent':'rend','sent':'send',
    'spent':'spend','built':'build','held':'hold','told':'tell',
    'sold':'sell','said':'say','paid':'pay','laid':'lay',
    'stood':'stand','bore':'bear','broke':'break','chose':'choose',
    'drove':'drive','froze':'freeze','hid':'hide','rode':'ride',
    'rose':'rise','shone':'shine','smote':'smite','spoke':'speak',
    'stole':'steal','strode':'stride','swore':'swear','tore':'tear',
    'wore':'wear','woke':'wake','wrote':'write','knew':'know',
    'blew':'blow','drew':'draw','flew':'fly','grew':'grow',
    'threw':'throw','saw':'see','ran':'run','ate':'eat',
    'drank':'drink','sang':'sing','rang':'ring','sat':'sit',
    'lay':'lie','led':'lead','bled':'bleed','fed':'feed',
    'fled':'flee','met':'meet','sped':'speed','shed':'shed',
    'spread':'spread','slew':'slay','arose':'arise','began':'begin',
    'begot':'beget','bit':'bite','forbade':'forbid','forgave':'forgive',
    'spake':'speak','bare':'bear','wilt':'will','hath':'have',
    'art':'are','doth':'do','dost':'do','saith':'say','canst':'can',
}

# ── Simple English suffix stemmer ─────────────────────────────────────────────

_SFXS = ['edness','nesses','ness','tions','tion','ations','ation','ings',
          'ingly','ing','edly','edly','ers','er','ied','ies','iest','est',
          'ful','less','ly','ed','es','s']

def stem(word: str) -> str:
    for sfx in _SFXS:
        if word.endswith(sfx) and len(word) - len(sfx) >= 3:
            return word[:-len(sfx)]
    return word

def variants(word: str) -> set[str]:
    """Return the word, its irregular base, and stems of both."""
    base = IRREG.get(word, word)
    s1 = stem(word)
    s2 = stem(base)
    return {word, base, s1, s2}

# Words to strip from Strong's definitions — truly non-discriminative linguistic
# metadata words that appear across many entries and don't help alignment.
# Do NOT include content words like make/give/bring/call/say.
NOISE = {
    # particles / prepositions / articles
    'the','a','an','and','or','of','in','to','for','with','by',
    'be','is','are','was','not','no','all','also','any','but','as',
    'at','on','up','so','if','it','its','one','him','his','her',
    'they','them','their','this','that','these','those','which','who','what','how',
    'when','where','may','can','will','would','could','should',
    'have','has','had','do','does','did','shall','been','being',
    'from','into','upon','over','out','off','about','through','than',
    'then','even','only','very','more','most','such','own','same',
    'yet','now','here','there','thus','hence','etc',
    # definition metadata (not translation words)
    'ie','esp','freq','lit','fig','prop','spec','trans','mid','pass',
    'act','intr','gen','met','ref','sense','form','part','kind',
    'manner','word','thing','person','time','place','way','means',
    'used','see','also','other','another','some','many','often',
    'rarely','usually','chiefly','especially','particularly',
}

# English words treated as pure function words — skip pass 1; align positionally
FUNC = {
    'the','a','an','and','but','or','nor','of','in','to','for','with','by',
    'from','at','as','that','this','which','who','whom','whose','not','no',
    'is','are','was','were','be','been','being','have','has','had',
    'he','she','it','they','them','his','her','its','their',
    'my','me','i','we','us','our','you','your',
    'will','shall','may','might','can','could','would','should',
    'upon','into','out','up','down','on','off','over','under',
    'all','every','each','both','then','there','here','also','so',
    'if','when','where','how','why','what',
    'after','before','about','between','among','through',
    'against','without','within','because','unto',
    # archaic Brenton / KJV forms
    'thou','thee','thy','thine','ye','hath','doth','art','wilt','hast',
    'didst','wast','saith','shalt','wouldest','shouldest',
    'therefore','wherefore','thereof','therein','thereto','therewith',
    'wherein','whereby','herein','hereof','hereunto','herewith',
    'neither','whether','lest','though','yet','now','still','again',
}

# ── Definition keyword extraction ─────────────────────────────────────────────

def kw_from_def(short_def: str) -> set[str]:
    if not short_def:
        return set()
    text = re.sub(r'\([^)]*\)', ' ', short_def)   # remove (examples in parens)
    text = re.sub(r'[+X\-]', ' ', text)           # strip markup chars
    text = re.sub(r'\d+', ' ', text)              # strip numbers
    words = re.findall(r"[a-zA-Z']{2,}", text)
    return {w.lower() for w in words} - NOISE


def kw_from_def_raw(short_def: str) -> set[str]:
    """Same extraction as kw_from_def but WITHOUT stripping NOISE — needed for
    function-word matching in Pass 2, since NOISE deliberately removes exactly the
    words (the/and/but/of/etc.) that identify a function word's own G-number.
    """
    if not short_def:
        return set()
    text = re.sub(r'\([^)]*\)', ' ', short_def)
    text = re.sub(r'[+X\-]', ' ', text)
    text = re.sub(r'\d+', ' ', text)
    words = re.findall(r"[a-zA-Z']{2,}", text)
    return {w.lower() for w in words}

# ── Rahlfs text_tagged parser ─────────────────────────────────────────────────

def parse_rahlfs(tagged: str) -> list[tuple[str, str]]:
    """'ἐν{G1722} ἀρχῇ{G746}' → [('ἐν','G1722'), ('ἀρχῇ','G746'), ...]"""
    out = []
    for tok in tagged.split():
        m = re.match(r'^(.+?)\{(G\d*)\}$', tok)
        out.append((m.group(1), m.group(2)) if m else (tok, ''))
    return out

# ── Alignment core ────────────────────────────────────────────────────────────

def align(greek_tokens: list[tuple[str, str]], english_text: str,
          def_dict: dict[str, set[str]], raw_def_dict: dict[str, set[str]]) -> str:
    """
    Assign a G-number to each English word using gloss matching (Pass 1, content
    words) followed by window-constrained gloss matching for whatever's left
    (Pass 2, overwhelmingly function words). Returns text_tagged in KJVA format:
    "word{G1234} word{} ..."
    """
    raw = english_text.split()
    if not raw or not greek_tokens:
        return ' '.join(f"{t}{{}}" for t in raw)

    n_g, n_e = len(greek_tokens), len(raw)

    # Tokenise: (original_token, clean_lower) — punctuation stays attached
    parsed: list[tuple[str, str]] = []
    for tok in raw:
        m = re.match(r"^[^A-Za-z']*([A-Za-z'][A-Za-z'-]*)[^A-Za-z'-]*$", tok)
        parsed.append((tok, m.group(1).lower() if m else ''))

    assignments: dict[int, str] = {}
    assign_j: dict[int, int] = {}
    greek_used: set[int] = set()

    # ── Pass 1: content word → G-number matching ──────────────────────────────
    cand: list[tuple[float, int, int, str]] = []
    for i, (orig, clean) in enumerate(parsed):
        if not clean or clean in FUNC:
            continue
        vs = variants(clean)         # word + irregular base + stems
        vs_stems = {stem(v) for v in vs}
        for j, (gw, gs) in enumerate(greek_tokens):
            if j in greek_used or not gs:
                continue
            kw = def_dict.get(gs, set())
            if not kw:
                continue
            kw_stems = {stem(k) for k in kw}

            score = 0.0
            if vs & kw:                        # exact match against any variant
                score = 4.0
            elif vs_stems & kw_stems:          # stem match
                score = 3.0
            elif len(clean) >= 4 and any(
                    v[:4] == k[:4] for v in vs for k in kw
                    if len(v) >= 4 and len(k) >= 4):
                score = 2.0

            if score > 0.0:
                exp_j = (i / n_e) * n_g
                pos   = 0.5 * max(0.0, 1.0 - abs(j - exp_j) / max(n_g, 1))
                cand.append((score + pos, i, j, gs))

    cand.sort(reverse=True)
    for _, i, j, gs in cand:
        if i not in assignments and j not in greek_used:
            assignments[i] = gs
            assign_j[i] = j
            greek_used.add(j)

    # ── Pass 2: window-constrained matching for whatever Pass 1 left unresolved ──
    # Rather than guessing a leftover token's position across the WHOLE verse
    # (the old approach — unreliable since Greek/English word order and word
    # count don't line up 1:1, especially around postpositive particles like
    # δέ/γάρ and inserted English copulas), constrain each match to the local
    # window strictly BETWEEN two Pass-1-anchored content words (or the verse
    # boundary, for the first/last window). Anchors are already known-correct,
    # so a leftover token can only steal a neighbor's number from within its own
    # bounded window, never from clear across the verse.
    anchors = sorted(assign_j.items())  # [(i, j), ...] in English order
    bounds = [(-1, -1)] + anchors + [(n_e, n_g)]

    for k in range(len(bounds) - 1):
        i_lo, j_lo = bounds[k]
        i_hi, j_hi = bounds[k + 1]
        e_slice = list(range(i_lo + 1, i_hi))
        g_slice = [j for j in range(j_lo + 1, j_hi) if j not in greek_used and greek_tokens[j][1]]
        if not e_slice or not g_slice:
            continue

        local_cand: list[tuple[float, int, int, str]] = []
        for i in e_slice:
            if i in assignments:
                continue
            orig, clean = parsed[i]
            if not clean:
                continue
            vs = variants(clean)
            vs_stems = {stem(v) for v in vs}
            for j in g_slice:
                gs = greek_tokens[j][1]
                kw_raw = raw_def_dict.get(gs, set())   # includes function-word glosses (the/and/but/…)
                kw     = def_dict.get(gs, set())       # noise-filtered — still useful for content words
                score = 0.0
                if vs & kw_raw:
                    score = 3.0
                elif vs & kw:
                    score = 2.5
                elif vs_stems & {stem(k) for k in kw_raw}:
                    score = 1.5
                if score == 0.0:
                    continue
                # Small order-preserving tiebreaker WITHIN the window only — never used to
                # pull in a candidate that didn't already match a gloss above.
                span_e = max(1, i_hi - i_lo)
                span_g = max(1, j_hi - j_lo)
                rel_i = (i - i_lo) / span_e
                rel_j = (j - j_lo) / span_g
                pos = 0.4 * max(0.0, 1.0 - abs(rel_i - rel_j))
                local_cand.append((score + pos, i, j, gs))

        local_cand.sort(reverse=True)
        for _, i, j, gs in local_cand:
            if i not in assignments and j not in greek_used:
                assignments[i] = gs
                greek_used.add(j)

        # Ordered leftover fallback: a handful of windows have a real Greek counterpart
        # whose short_def just doesn't share vocabulary with Brenton's chosen English word
        # (e.g. ἐπιφέρω/G2018 glossed "bring, take, add" translated "moved") — no gloss
        # match is possible for those, but leaving them empty would be a regression versus
        # the old (whole-verse-positional) tagging, which got these particular cases right.
        # Safe here specifically because the window is already bounded by two verified
        # anchors, not the whole verse — pair whatever's left, in order, only within that
        # narrow span.
        e_left = [i for i in e_slice if i not in assignments and parsed[i][1]]
        g_left = [j for j in g_slice if j not in greek_used]
        for i, j in zip(e_left, g_left):
            assignments[i] = greek_tokens[j][1]
            greek_used.add(j)

    # Anything still unresolved (no Greek counterpart in its window, or an inserted
    # English word like a copula with nothing to match) is left untagged rather than
    # stealing a neighbor's number.
    return ' '.join(f"{orig}{{{assignments.get(i, '')}}}"
                    for i, (orig, _) in enumerate(parsed))

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    lxx_db     = sqlite3.connect(str(LXX_DB))
    brenton_db = sqlite3.connect(str(BRENTON_DB))
    strongs_db = sqlite3.connect(str(STRONGS_DB))

    try:
        brenton_db.execute("ALTER TABLE verses ADD COLUMN text_tagged TEXT")
        brenton_db.commit()
        print("Added text_tagged column to lxx_brenton.db")
    except sqlite3.OperationalError:
        print("text_tagged column already exists (overwriting)")

    # G-number → keyword set (noise-filtered, for content-word Pass 1 + fallback in Pass 2)
    # and a second, unfiltered version (raw_def_dict) needed for Pass 2's function-word
    # matching — NOISE deliberately strips the/and/but/of/etc., which are exactly the
    # words that identify a function word's own G-number.
    print("Building definition dictionary …")
    def_dict: dict[str, set[str]] = {}
    raw_def_dict: dict[str, set[str]] = {}
    for gnum, short_def in strongs_db.execute(
            "SELECT strongs_id, short_def FROM entries").fetchall():
        def_dict[gnum] = kw_from_def(short_def or '')
        raw_def_dict[gnum] = kw_from_def_raw(short_def or '')
    print(f"  {len(def_dict)} G-numbers")

    # Rahlfs tagged verse lookup
    print("Loading Rahlfs tagged verses …")
    rahlfs: dict[tuple[str, int, int], str] = {}
    for bid, ch, vs, tagged in lxx_db.execute(
            "SELECT book_id, chapter, verse_num, text_tagged FROM verses "
            "WHERE text_tagged IS NOT NULL AND text_tagged != ''"):
        rahlfs[(bid, ch, vs)] = tagged
    print(f"  {len(rahlfs)} tagged verses")

    # Brenton verse rows
    print("Aligning …")
    rows = brenton_db.execute(
        "SELECT id, book_id, chapter, verse_num, text FROM verses ORDER BY id"
    ).fetchall()

    updates: list[tuple[str, int]] = []
    matched = skipped = 0

    for vid, bid, ch, vs, eng in rows:
        tagged = rahlfs.get((bid, ch, vs))
        if not tagged:
            skipped += 1
            continue
        gt = parse_rahlfs(tagged)
        updates.append((align(gt, eng, def_dict, raw_def_dict), vid))
        matched += 1
        if matched % 3000 == 0:
            print(f"  {matched} / {len(rows)} …")

    print(f"Writing {len(updates)} rows …")
    brenton_db.executemany("UPDATE verses SET text_tagged = ? WHERE id = ?", updates)
    brenton_db.commit()

    total = len(rows)
    pct   = 100 * matched // total if total else 0
    print(f"\nDone — {matched}/{total} verses tagged ({pct}%), {skipped} skipped")

    # Spot-check
    for ref, bid, ch, vs in [
        ("Gen 1:1",  "GEN", 1, 1),
        ("Gen 1:2",  "GEN", 1, 2),
        ("Ps 23:1",  "PSA", 23, 1),
        ("Isa 53:1", "ISA", 53, 1),
    ]:
        row = brenton_db.execute(
            "SELECT text_tagged FROM verses WHERE book_id=? AND chapter=? AND verse_num=?",
            (bid, ch, vs)
        ).fetchone()
        if row:
            print(f"\n{ref}: {row[0][:120]}")

    brenton_db.close()
    lxx_db.close()
    strongs_db.close()

if __name__ == '__main__':
    main()

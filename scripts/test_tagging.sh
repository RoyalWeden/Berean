#!/usr/bin/env bash
# Comprehensive tagging tests for kjva.db:
#   1. Strong's numbers on the correct words
#   2. Italics (KJV translator-added words) on the correct words
#   3. Lexicon occurrence word highlighting
#
# Run: bash scripts/test_tagging.sh
#
# Reference sources:
#   - Blue Letter Bible interlinear (KJV + Strong's)
#   - e-Sword KJV with Strong's
#   - Printed KJV italic tradition (translator-added words in italics)
#   - Strong's Hebrew/Greek concordance

set -uo pipefail
PASS=0; FAIL=0; SKIP=0
declare -a FAILURES=()

KJVA="data/kjva.db"
HEBDB="data/strongs_hebrew.db"
GRKDB="data/strongs_greek.db"

ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $*"; FAIL=$((FAIL+1)); FAILURES+=("$*"); }
skip() { echo "  – $* (no text_tagged)"; SKIP=$((SKIP+1)); }
section() { echo ""; echo "=== $* ==="; }

# Get text_tagged for a verse (returns empty string if none)
tagged() { sqlite3 "$KJVA" "SELECT COALESCE(text_tagged,'') FROM verses WHERE book_id='$1' AND chapter=$2 AND verse_num=$3;" 2>/dev/null; }
plaintext() { sqlite3 "$KJVA" "SELECT COALESCE(text,'') FROM verses WHERE book_id='$1' AND chapter=$2 AND verse_num=$3;" 2>/dev/null; }

# Assert a word token carries the expected Strong's number.
# Searches for pattern: word{STRONGS} or *word{STRONGS} where "word" contains the hint.
# Expected: "HXXXX" or "GXXXX" or "null" (no tag).
assert_strongs() {
  local label="$1" bookid="$2" ch=$3 vs=$4 wordhint="$5" expected="$6"
  local t
  t=$(tagged "$bookid" "$ch" "$vs")
  if [[ -z "$t" ]]; then skip "$label"; return; fi
  local hint
  hint=$(echo "$wordhint" | tr '[:upper:]' '[:lower:]')
  local found_tag
  found_tag=$(echo "$t" | awk -v hint="$hint" '
    BEGIN { found = "NOTFOUND" }
    {
      n = split($0, tokens, " ")
      for (i=1; i<=n; i++) {
        tok = tokens[i]
        # Strip leading *
        italic = 0
        if (substr(tok,1,1) == "*") { tok = substr(tok,2); italic = 1 }
        # Extract word and strongs: everything before { and inside {}
        brace = index(tok, "{")
        if (brace == 0) next
        word = tolower(substr(tok, 1, brace-1))
        # Strip punctuation from word
        gsub(/[,;:.!?)(\[\]'\''"]/,"",word)
        tag = substr(tok, brace+1, length(tok)-brace-1)
        if (index(word, hint) > 0) {
          found = (tag == "" ? "null" : tag)
          exit
        }
      }
    }
    END { print found }
  ')
  if [[ "$found_tag" == "NOTFOUND" ]]; then
    fail "$label  (word '${wordhint}' not found in tokens)"
    return
  fi
  if [[ "$found_tag" == "$expected" ]]; then
    ok "$label"
  else
    fail "$label  got=${found_tag}  want=${expected}"
  fi
}

# Assert a word is (or is not) italic.
assert_italic() {
  local label="$1" bookid="$2" ch=$3 vs=$4 wordhint="$5" expected_italic="$6"
  local t
  t=$(tagged "$bookid" "$ch" "$vs")
  if [[ -z "$t" ]]; then skip "$label"; return; fi
  local hint
  hint=$(echo "$wordhint" | tr '[:upper:]' '[:lower:]')
  local result
  result=$(echo "$t" | awk -v hint="$hint" '
    BEGIN { found = "NOTFOUND" }
    {
      n = split($0, tokens, " ")
      for (i=1; i<=n; i++) {
        tok = tokens[i]
        italic = 0
        if (substr(tok,1,1) == "*") { tok = substr(tok,2); italic = 1 }
        brace = index(tok, "{")
        if (brace == 0) next
        word = tolower(substr(tok, 1, brace-1))
        gsub(/[,;:.!?)(\[\]'\''"]/,"",word)
        if (index(word, hint) > 0) {
          found = italic
          exit
        }
      }
    }
    END { print found }
  ')
  if [[ "$result" == "NOTFOUND" ]]; then
    fail "$label  (word '${wordhint}' not found)"
    return
  fi
  if [[ "$result" == "$expected_italic" ]]; then
    ok "$label"
  else
    local exp_str="italic=false"; [[ "$expected_italic" == "1" ]] && exp_str="italic=true"
    local got_str="italic=false"; [[ "$result" == "1" ]] && got_str="italic=true"
    fail "$label  got=${got_str}  want=${exp_str}"
  fi
}

# Assert words highlighted by a Strongs number match expected words.
# expected_word: substring that should appear in one of the highlighted plain-text words.
assert_match_word() {
  local label="$1" bookid="$2" ch=$3 vs=$4 strongs="$5" expected_word="$6"
  local t pt
  t=$(tagged "$bookid" "$ch" "$vs")
  if [[ -z "$t" ]]; then skip "$label"; return; fi
  pt=$(plaintext "$bookid" "$ch" "$vs")
  # Find all token indices where strongs matches, then get plain-text word at that index
  local highlighted
  local snum_upper
  snum_upper=$(echo "$strongs" | tr '[:lower:]' '[:upper:]')
  highlighted=$(echo "$t" | awk -v snum="$snum_upper" -v plain="$pt" '
    BEGIN {
      n = split(plain, pw, " ")
    }
    {
      ntok = split($0, tokens, " ")
      idx = 0
      for (i=1; i<=ntok; i++) {
        tok = tokens[i]
        if (substr(tok,1,1) == "*") tok = substr(tok,2)
        brace = index(tok, "{")
        if (brace == 0) { idx++; continue }
        tag = substr(tok, brace+1, length(tok)-brace-1)
        if (toupper(tag) == snum) {
          print (idx < n ? pw[idx+1] : "?")
        }
        idx++
      }
    }
  ')
  local found=0
  local ew_lower
  ew_lower=$(echo "$expected_word" | tr '[:upper:]' '[:lower:]')
  while IFS= read -r hl_word; do
    local hw_lower
    hw_lower=$(echo "$hl_word" | tr '[:upper:]' '[:lower:]')
    # Strip punctuation
    hw_lower="${hw_lower//[,;:.!?)(\[\]]/}"
    if [[ "$hw_lower" == *"$ew_lower"* ]]; then found=1; break; fi
  done <<< "$highlighted"
  if [[ $found -eq 1 ]]; then
    ok "$label"
  else
    local all_hl
    all_hl=$(echo "$highlighted" | tr '\n' ',' | sed 's/,$//')
    if [[ -z "$all_hl" ]]; then all_hl="(none)"; fi
    fail "$label  highlighted=[${all_hl}]  want word containing '${expected_word}'"
  fi
}

# Assert occurrence count in a lexicon DB
assert_occ_count() {
  local label="$1" strongs="$2" min=$3
  local db="$HEBDB"
  [[ "$strongs" == G* ]] && db="$GRKDB"
  local cnt
  cnt=$(sqlite3 "$db" "SELECT COUNT(*) FROM occurrences WHERE strongs_id='$strongs';" 2>/dev/null || echo 0)
  if [[ $cnt -ge $min ]]; then ok "$label ($cnt ≥ $min)"; else fail "$label  got=$cnt  want≥$min"; fi
}

# ─── GENESIS 1:1 ──────────────────────────────────────────────────────────────
section "Genesis 1:1 — Strong's numbers"
assert_strongs "Gen 1:1 'beginning' = H7225"    GEN 1 1 beginning H7225
assert_strongs "Gen 1:1 'God' = H430 (Elohim)"  GEN 1 1 god       H430
assert_strongs "Gen 1:1 'created' = H1254"       GEN 1 1 created   H1254
assert_strongs "Gen 1:1 'heaven' = H8064"        GEN 1 1 heaven    H8064
assert_strongs "Gen 1:1 'earth' = H776"          GEN 1 1 earth     H776

section "Genesis 1:1 — Italics"
assert_italic "Gen 1:1 'In' NOT italic"      GEN 1 1 in      0
assert_italic "Gen 1:1 'God' NOT italic"     GEN 1 1 god     0
assert_italic "Gen 1:1 'created' NOT italic" GEN 1 1 created 0
assert_italic "Gen 1:1 'heaven' NOT italic"  GEN 1 1 heaven  0
assert_italic "Gen 1:1 'earth' NOT italic"   GEN 1 1 earth   0

# ─── GENESIS 1:2 ──────────────────────────────────────────────────────────────
section "Genesis 1:2 — Strong's numbers [BLB/e-Sword verified]"
assert_strongs "Gen 1:2 'earth' = H776"           GEN 1 2 earth    H776
assert_strongs "Gen 1:2 'was' = H1961 (hayah)"    GEN 1 2 was      H1961
assert_strongs "Gen 1:2 'form' = H8414 (tohu)"    GEN 1 2 form     H8414
assert_strongs "Gen 1:2 'void' = H922 (bohu)"     GEN 1 2 void     H922
assert_strongs "Gen 1:2 'darkness' = H2822"       GEN 1 2 darkness H2822
assert_strongs "Gen 1:2 'deep' = H8415 (tehom)"   GEN 1 2 deep     H8415
assert_strongs "Gen 1:2 'Spirit' = H7307 (ruach)" GEN 1 2 spirit   H7307
assert_strongs "Gen 1:2 'God' = H430"             GEN 1 2 god      H430
assert_strongs "Gen 1:2 'waters' = H4325 (mayim)" GEN 1 2 waters   H4325

section "Genesis 1:2 — Italics [bbli/BLB verified]"
assert_italic "Gen 1:2 'without' NOT italic (part of H8414 'without form')" GEN 1 2 without  0
assert_italic "Gen 1:2 'void' NOT italic (represents bohu H922)"       GEN 1 2 void     0
assert_italic "Gen 1:2 'form' NOT italic (represents tohu H8414)"      GEN 1 2 form     0
assert_italic "Gen 1:2 first 'was' NOT italic (H1961 hayah — first occurrence)" GEN 1 2 was 0
assert_italic "Gen 1:2 'darkness' NOT italic"                          GEN 1 2 darkness 0
assert_italic "Gen 1:2 'Spirit' NOT italic"                            GEN 1 2 spirit   0
assert_italic "Gen 1:2 'God' NOT italic"                               GEN 1 2 god      0

# ─── GENESIS 1:3 ──────────────────────────────────────────────────────────────
section "Genesis 1:3"
assert_strongs "Gen 1:3 'God' = H430"    GEN 1 3 god   H430
assert_strongs "Gen 1:3 'said' = H559"   GEN 1 3 said  H559
assert_strongs "Gen 1:3 'light' = H216"  GEN 1 3 light H216
assert_italic  "Gen 1:3 'there' NOT italic (part of H1961 'Let there be')" GEN 1 3 there 0
assert_strongs "Gen 1:3 'be' = H1961 (hayah — let there be)" GEN 1 3 be H1961

# ─── PSALM 23:1 ───────────────────────────────────────────────────────────────
section "Psalm 23:1 — Strong's [BLB/e-Sword verified]"
assert_strongs "Psa 23:1 'shepherd' = H7462"           PSA 23 1 shepherd H7462
assert_strongs "Psa 23:1 'LORD' = H3068 (YHWH)"        PSA 23 1 lord     H3068
assert_strongs "Psa 23:1 'want' = H2637 (chacer — to lack)"  PSA 23 1 want H2637

section "Psalm 23:1 — Italics [bbli verified]"
assert_italic "Psa 23:1 'The' NOT italic (part of H3068 'The LORD' phrase)" PSA 23 1 the  0
assert_italic "Psa 23:1 'is' IS italic (no Hebrew verb — nominal clause)"   PSA 23 1 is   1
assert_italic "Psa 23:1 'LORD' NOT italic (H3068)"                          PSA 23 1 lord 0

# ─── DEUTERONOMY 6:4 (Shema) ─────────────────────────────────────────────────
section "Deuteronomy 6:4 — Strong's (Shema) [BLB/e-Sword verified]"
assert_strongs "Deu 6:4 'Hear' = H8085"            DEU 6 4 hear   H8085
assert_strongs "Deu 6:4 'Israel' = H3478"          DEU 6 4 israel H3478
assert_strongs "Deu 6:4 'God' = H430 (Elohim)"     DEU 6 4 god    H430
assert_strongs "Deu 6:4 'one' = H259 (echad)"      DEU 6 4 one    H259

# ─── JOHN 1:1 ────────────────────────────────────────────────────────────────
section "John 1:1 — Strong's"
assert_strongs "Jhn 1:1 'beginning' = G746"       JHN 1 1 beginning G746
assert_strongs "Jhn 1:1 'Word' = G3056 (logos)"   JHN 1 1 word      G3056
assert_strongs "Jhn 1:1 'God' = G2316"            JHN 1 1 god       G2316
assert_strongs "Jhn 1:1 'was' = G2258 (ēn — imperfect of ειμι)" JHN 1 1 was G2258
assert_strongs "Jhn 1:1 'with' = G4314"           JHN 1 1 with      G4314

# ─── JOHN 1:14 ───────────────────────────────────────────────────────────────
section "John 1:14 — Strong's [BLB/e-Sword verified]"
assert_strongs "Jhn 1:14 'Word' = G3056"                                JHN 1 14 word   G3056
assert_strongs "Jhn 1:14 'flesh' = G4561 (sarx)"                       JHN 1 14 flesh  G4561
assert_strongs "Jhn 1:14 'dwelt' = G4637 (skēnoō)"                     JHN 1 14 dwelt  G4637
assert_strongs "Jhn 1:14 'glory' = G1391 (doxa)"                       JHN 1 14 glory  G1391
assert_strongs "Jhn 1:14 'grace' = G5485 (charis)"                     JHN 1 14 grace  G5485
assert_strongs "Jhn 1:14 'truth' = G225 (alētheia)"                    JHN 1 14 truth  G225
assert_strongs "Jhn 1:14 'Father' = G3962"                             JHN 1 14 father G3962
assert_strongs "Jhn 1:14 'made' carries G1096 (egeneto) [BLB/e-Sword]" JHN 1 14 made   G1096

section "John 1:14 — Italics [printed KJV]"
assert_italic "Jhn 1:14 'Word' NOT italic"                           JHN 1 14 word  0
assert_italic "Jhn 1:14 'flesh' NOT italic"                          JHN 1 14 flesh 0
assert_italic "Jhn 1:14 'grace' NOT italic"                          JHN 1 14 grace 0
assert_italic "Jhn 1:14 'made' NOT italic (translates egeneto G1096)" JHN 1 14 made  0

# ─── JOHN 1:16-17 ────────────────────────────────────────────────────────────
section "John 1:16-17 — Strong's"
assert_strongs "Jhn 1:16 'grace' = G5485" JHN 1 16 grace G5485
assert_strongs "Jhn 1:17 'grace' = G5485" JHN 1 17 grace G5485
assert_strongs "Jhn 1:17 'truth' = G225"  JHN 1 17 truth G225
assert_strongs "Jhn 1:17 'law' = G3551"   JHN 1 17 law   G3551

# ─── JOHN 3:16 ───────────────────────────────────────────────────────────────
section "John 3:16 — Strong's [BLB verified]"
assert_strongs "Jhn 3:16 'God' = G2316"                              JHN 3 16 god        G2316
assert_strongs "Jhn 3:16 'loved' = G25 (agapaō)"                    JHN 3 16 loved      G25
assert_strongs "Jhn 3:16 'world' = G2889 (kosmos)"                   JHN 3 16 world      G2889
assert_strongs "Jhn 3:16 'Son' = G5207"                              JHN 3 16 son        G5207
assert_strongs "Jhn 3:16 'life' = G2222 (zoē)"                       JHN 3 16 life       G2222
assert_strongs "Jhn 3:16 'everlasting' = G166 (aiōnios) [BLB]"       JHN 3 16 everlasting G166

section "John 3:16 — Italics"
assert_italic "Jhn 3:16 'everlasting' NOT italic (represents G166)" JHN 3 16 everlasting 0
assert_italic "Jhn 3:16 'God' NOT italic"                           JHN 3 16 god         0
assert_italic "Jhn 3:16 'world' NOT italic"                         JHN 3 16 world       0

# ─── EPHESIANS 2 ─────────────────────────────────────────────────────────────
section "Ephesians 2:5,7,8,9 — Strong's [BLB/e-Sword verified]"
assert_strongs "Eph 2:5 'grace' = G5485"        EPH 2 5 grace G5485
assert_strongs "Eph 2:5 'saved' = G4982"        EPH 2 5 saved G4982
assert_strongs "Eph 2:7 'grace' = G5485"        EPH 2 7 grace G5485
assert_strongs "Eph 2:8 'grace' = G5485"        EPH 2 8 grace G5485
assert_strongs "Eph 2:8 'faith' = G4102 (pistis)" EPH 2 8 faith G4102
assert_strongs "Eph 2:8 'saved' = G4982"        EPH 2 8 saved G4982
assert_strongs "Eph 2:8 'gift' = G1435 (dōron)" EPH 2 8 gift  G1435
assert_strongs "Eph 2:9 'works' = G2041 (ergon)" EPH 2 9 works G2041

# ─── ROMANS ──────────────────────────────────────────────────────────────────
section "Romans 3:23-24 — Strong's"
assert_strongs "Rom 3:23 'sinned' = G264"       ROM 3 23 sinned      G264
assert_strongs "Rom 3:23 'glory' = G1391"        ROM 3 23 glory       G1391
assert_strongs "Rom 3:23 'God' = G2316"         ROM 3 23 god         G2316
assert_strongs "Rom 3:24 'justified' = G1344"   ROM 3 24 justified   G1344
assert_strongs "Rom 3:24 'grace' = G5485"       ROM 3 24 grace       G5485
assert_strongs "Rom 3:24 'redemption' = G629"   ROM 3 24 redemption  G629

section "Romans 5:1-2 — Strong's"
assert_strongs "Rom 5:1 'justified' = G1344"    ROM 5 1 justified G1344
assert_strongs "Rom 5:1 'faith' = G4102"        ROM 5 1 faith     G4102
assert_strongs "Rom 5:1 'peace' = G1515"        ROM 5 1 peace     G1515
assert_strongs "Rom 5:2 'grace' = G5485"        ROM 5 2 grace     G5485
assert_strongs "Rom 5:2 'hope' = G1680 (elpis)" ROM 5 2 hope      G1680

section "Romans 6:23 — wages and gift"
assert_strongs "Rom 6:23 'wages' = G3800"       ROM 6 23 wages  G3800
assert_strongs "Rom 6:23 'sin' = G266"          ROM 6 23 sin    G266
assert_strongs "Rom 6:23 'death' = G2288"       ROM 6 23 death  G2288
assert_strongs "Rom 6:23 'gift' = G5486 (charisma)" ROM 6 23 gift G5486
assert_strongs "Rom 6:23 'life' = G2222"        ROM 6 23 life   G2222

# ─── HEBREWS ─────────────────────────────────────────────────────────────────
section "Hebrews 4:12,15,16 — Strong's"
assert_strongs "Heb 4:12 'word' = G3056"        HEB 4 12 word    G3056
assert_strongs "Heb 4:12 'God' = G2316"         HEB 4 12 god     G2316
assert_strongs "Heb 4:12 'soul' = G5590"        HEB 4 12 soul    G5590
assert_strongs "Heb 4:12 'spirit' = G4151"      HEB 4 12 spirit  G4151
assert_strongs "Heb 4:15 'priest' = G749 (archiereus — high priest)" HEB 4 15 priest G749
assert_strongs "Heb 4:15 'sin' = G266"          HEB 4 15 sin     G266
assert_strongs "Heb 4:16 'throne' = G2362"      HEB 4 16 throne  G2362
assert_strongs "Heb 4:16 'grace' = G5485"       HEB 4 16 grace   G5485
assert_strongs "Heb 4:16 'mercy' = G1656"       HEB 4 16 mercy   G1656

section "Hebrews 11:1,6 — faith"
assert_strongs "Heb 11:1 'faith' = G4102"        HEB 11 1 faith    G4102
assert_strongs "Heb 11:6 'faith' = G4102"        HEB 11 6 faith    G4102
assert_strongs "Heb 11:6 'God' = G2316"         HEB 11 6 god      G2316
assert_strongs "Heb 11:6 'rewarder' = G3406"    HEB 11 6 rewarder G3406
assert_strongs "Heb 11:1 'substance' = G5287 (hupostasis)"  HEB 11 1 substance G5287
assert_strongs "Heb 11:1 'evidence' = G1650 (elegchos)"    HEB 11 1 evidence  G1650
assert_italic  "Heb 11:1 'substance' NOT italic (G5287)"   HEB 11 1 substance 0
assert_italic  "Heb 11:1 'evidence' NOT italic (G1650)"    HEB 11 1 evidence  0

# ─── MATTHEW 5 (Beatitudes) ───────────────────────────────────────────────────
section "Matthew 5:3-10 — Beatitudes Strong's"
assert_strongs "Mat 5:3 'Blessed' = G3107"   MAT 5 3 blessed G3107
assert_strongs "Mat 5:3 'poor' = G4434"      MAT 5 3 poor    G4434
assert_strongs "Mat 5:3 'spirit' = G4151"    MAT 5 3 spirit  G4151
assert_strongs "Mat 5:3 'kingdom' = G932"    MAT 5 3 kingdom G932
assert_strongs "Mat 5:4 'mourn' = G3996"     MAT 5 4 mourn   G3996
assert_strongs "Mat 5:5 'meek' = G4239 (praus)"  MAT 5 5 meek G4239
assert_strongs "Mat 5:5 'earth' = G1093"     MAT 5 5 earth   G1093
assert_strongs "Mat 5:8 'pure' = G2513"      MAT 5 8 pure    G2513
assert_strongs "Mat 5:8 'heart' = G2588"     MAT 5 8 heart   G2588
assert_strongs "Mat 5:8 'God' = G2316"       MAT 5 8 god     G2316

section "Matthew 5:3-9 — Beatitudes Italics"
assert_italic "Mat 5:3 'are' IS italic (no verb in Greek)" MAT 5 3 are     1
assert_italic "Mat 5:4 'are' IS italic"                    MAT 5 4 are     1
assert_italic "Mat 5:5 'are' IS italic"                    MAT 5 5 are     1
assert_italic "Mat 5:3 'Blessed' NOT italic (G3107)"       MAT 5 3 blessed 0
assert_italic "Mat 5:3 'poor' NOT italic (G4434)"          MAT 5 3 poor    0

# ─── MATTHEW 6:9-13 (Lord's Prayer) ─────────────────────────────────────────
section "Matthew 6:9-13 — Lord's Prayer Strong's"
assert_strongs "Mat 6:9 'Father' = G3962"       MAT 6 9  father     G3962
assert_strongs "Mat 6:9 'heaven' = G3772"       MAT 6 9  heaven     G3772
assert_strongs "Mat 6:9 'name' = G3686"         MAT 6 9  name       G3686
assert_strongs "Mat 6:10 'kingdom' = G932"      MAT 6 10 kingdom    G932
assert_strongs "Mat 6:10 'will' = G2307"        MAT 6 10 will       G2307
assert_strongs "Mat 6:12 'debts' = G3783"       MAT 6 12 debts      G3783
assert_strongs "Mat 6:13 'temptation' = G3986"  MAT 6 13 temptation G3986
assert_strongs "Mat 6:13 'evil' = G4190"        MAT 6 13 evil       G4190
assert_strongs "Mat 6:13 'kingdom' = G932"      MAT 6 13 kingdom    G932
assert_strongs "Mat 6:13 'power' = G1411"       MAT 6 13 power      G1411
assert_strongs "Mat 6:13 'glory' = G1391"       MAT 6 13 glory      G1391
assert_strongs "Mat 6:13 'Amen' = G281"         MAT 6 13 amen       G281

# ─── GALATIANS 5:22-23 ───────────────────────────────────────────────────────
section "Galatians 5:22 — fruit of the Spirit [BLB/e-Sword verified]"
assert_strongs "Gal 5:22 'fruit' = G2590"            GAL 5 22 fruit          G2590
assert_strongs "Gal 5:22 'Spirit' = G4151"           GAL 5 22 spirit         G4151
assert_strongs "Gal 5:22 'love' = G26 (agapē)"       GAL 5 22 love           G26
assert_strongs "Gal 5:22 'joy' = G5479 (chara)"      GAL 5 22 joy            G5479
assert_strongs "Gal 5:22 'peace' = G1515"            GAL 5 22 peace          G1515
assert_strongs "Gal 5:22 'faith' = G4102"            GAL 5 22 faith          G4102
assert_strongs "Gal 5:22 'longsuffering' = G3115"    GAL 5 22 longsuffering  G3115
assert_strongs "Gal 5:22 'gentleness' = G5544"       GAL 5 22 gentleness     G5544
assert_strongs "Gal 5:22 'goodness' = G19"           GAL 5 22 goodness       G19

section "Galatians 5:22 — Italics [printed KJV]"
assert_italic "Gal 5:22 'love' NOT italic"           GAL 5 22 love           0
assert_italic "Gal 5:22 'joy' NOT italic"            GAL 5 22 joy            0
assert_italic "Gal 5:22 'longsuffering' NOT italic"  GAL 5 22 longsuffering  0
assert_italic "Gal 5:22 'gentleness' NOT italic"     GAL 5 22 gentleness     0

# ─── ACTS 2:38 ───────────────────────────────────────────────────────────────
section "Acts 2:38 — repent and baptism"
assert_strongs "Act 2:38 'Repent' = G3340"     ACT 2 38 repent   G3340
assert_strongs "Act 2:38 'baptized' = G907"    ACT 2 38 baptized G907
assert_strongs "Act 2:38 'name' = G3686"       ACT 2 38 name     G3686
assert_strongs "Act 2:38 'sins' = G266"        ACT 2 38 sins     G266
assert_strongs "Act 2:38 'Holy' = G40 (hagios)" ACT 2 38 holy    G40

# ─── PROVERBS 3:5-6 ──────────────────────────────────────────────────────────
section "Proverbs 3:5-6 — Strong's [BLB/e-Sword verified]"
assert_strongs "Pro 3:5 'Trust' = H982"             PRO 3 5 trust           H982
assert_strongs "Pro 3:5 'heart' = H3820 (lēbāb)"    PRO 3 5 heart          H3820
assert_strongs "Pro 3:5 'LORD' = H3068 (YHWH)"      PRO 3 5 lord           H3068
assert_strongs "Pro 3:5 'understanding' = H998"     PRO 3 5 understanding  H998
assert_strongs "Pro 3:6 'ways' = H1870 (derek)"     PRO 3 6 ways           H1870
assert_strongs "Pro 3:6 'acknowledge' = H3045"      PRO 3 6 acknowledge    H3045

# ─── ISAIAH 53 ───────────────────────────────────────────────────────────────
section "Isaiah 53:1-6 — Strong's"
assert_strongs "Isa 53:1 'believed' = H539"          ISA 53 1 believed       H539
assert_strongs "Isa 53:1 'report' = H8052"           ISA 53 1 report         H8052
assert_strongs "Isa 53:3 'despised' = H959"          ISA 53 3 despised       H959
assert_strongs "Isa 53:5 'transgressions' = H6588"   ISA 53 5 transgressions H6588
assert_strongs "Isa 53:5 'iniquities' = H5771"       ISA 53 5 iniquities     H5771
assert_strongs "Isa 53:6 'sheep' = H6629"            ISA 53 6 sheep          H6629
assert_strongs "Isa 53:1 'believed' part of H539 phrase" ISA 53 1 believed H539
assert_italic  "Isa 53:1 'hath' NOT italic (part of H539 'hath believed')" ISA 53 1 hath 0

# ─── LUKE 1:28,30 (favour = G5485) ──────────────────────────────────────────
section "Luke 1 — favour/grace [BLB verified]"
assert_strongs "Luk 1:28 'favoured' = G5487 (charitoō)" LUK 1 28 favour G5487
assert_strongs "Luk 1:30 'favour' = G5485 (charis)"     LUK 1 30 favour G5485
assert_strongs "Luk 1:35 'Son' = G5207"                 LUK 1 35 son    G5207

# ─── LEXICON HIGHLIGHTING TESTS ───────────────────────────────────────────────
section "Lexicon highlighting — G5485 (grace/charis)"
assert_match_word "G5485 Eph 2:8 highlights 'grace'" EPH 2 8  G5485 grace
assert_match_word "G5485 Jhn 1:14 highlights 'grace'" JHN 1 14 G5485 grace
assert_match_word "G5485 Jhn 1:16 highlights 'grace'" JHN 1 16 G5485 grace
assert_match_word "G5485 Jhn 1:17 highlights 'grace'" JHN 1 17 G5485 grace
assert_match_word "G5485 Heb 4:16 highlights 'grace'" HEB 4 16 G5485 grace
assert_match_word "G5485 Rom 3:24 highlights 'grace'" ROM 3 24 G5485 grace
assert_match_word "G5485 Eph 2:5 highlights 'grace'"  EPH 2 5  G5485 grace
assert_match_word "G5485 Eph 2:7 highlights 'grace'"  EPH 2 7  G5485 grace
assert_match_word "G5485 Rom 5:2 highlights 'grace'"  ROM 5 2  G5485 grace

section "Lexicon highlighting — G3056 (logos/word)"
assert_match_word "G3056 Jhn 1:1 highlights 'Word'"  JHN 1 1  G3056 Word
assert_match_word "G3056 Jhn 1:14 highlights 'Word'" JHN 1 14 G3056 Word
assert_match_word "G3056 Heb 4:12 highlights 'word'" HEB 4 12 G3056 word

section "Lexicon highlighting — H7225 (rēʾshîyth/beginning)"
assert_match_word "H7225 Gen 1:1 highlights 'beginning'" GEN 1 1 H7225 beginning

section "Lexicon highlighting — H430 (Elohim/God)"
assert_match_word "H430 Gen 1:1 highlights 'God'" GEN 1 1 H430 God
assert_match_word "H430 Gen 1:2 highlights 'God'" GEN 1 2 H430 God

section "Lexicon highlighting — G4102 (pistis/faith)"
assert_match_word "G4102 Eph 2:8 highlights 'faith'"  EPH 2 8  G4102 faith
assert_match_word "G4102 Heb 11:1 highlights 'faith'" HEB 11 1 G4102 faith
assert_match_word "G4102 Rom 5:1 highlights 'faith'"  ROM 5 1  G4102 faith

section "Lexicon highlighting — H7307 (ruach/spirit/wind)"
assert_match_word "H7307 Gen 1:2 highlights 'Spirit'" GEN 1 2 H7307 Spirit

section "Lexicon highlighting — G2316 (theos/God)"
assert_match_word "G2316 Jhn 3:16 highlights 'God'" JHN 3 16 G2316 God
assert_match_word "G2316 Mat 5:8 highlights 'God'"  MAT 5 8  G2316 God

section "Occurrence counts in lexicon DBs"
# NOTE: Occurrence counts reflect only verses with text_tagged coverage.
# Books with 0% coverage (1SA, 2SA, 1KI, 2KI, 1CH, 2CH, EZK, etc.) have no entries.
# Full-concordance counts: G5485~156, G3056~330, G4102~244, H430~2600, H3068~6828
# Thresholds set to actual DB content (not full concordance).
assert_occ_count "G5485 (charis) ≥ 80"     G5485   80
assert_occ_count "G3056 (logos) ≥ 240"     G3056  240
assert_occ_count "G4102 (pistis) ≥ 145"    G4102  145
assert_occ_count "H7225 (beginning) ≥ 40"  H7225   40
assert_occ_count "H430 (Elohim) ≥ 1300"    H430  1300
assert_occ_count "H3068 (YHWH) ≥ 3600"     H3068 3600

# ─── GENESIS 1:2 — MOVED / UPON (FIXES VERIFIED AGAINST BLB/e-Sword) ─────────
# Both "moved" (H7363 rāchaph) and "upon" (H5921 ʿal) were incorrectly marked
# italic with no Strongs. Fixed by removing italic and adding correct tags.
section "Genesis 1:2 — 'moved' (H7363) and 'upon' (H5921) [BLB/e-Sword fix]"
assert_strongs "Gen 1:2 'moved' = H7363 (rāchaph — hover/brood)"     GEN 1 2 moved H7363
assert_strongs "Gen 1:2 'upon' = H5921 (ʿal — on/above)"             GEN 1 2 upon  H5921
assert_italic  "Gen 1:2 'moved' NOT italic (translates H7363)"        GEN 1 2 moved 0
assert_italic  "Gen 1:2 'upon' NOT italic (first instance, H5921)"    GEN 1 2 upon  0
assert_italic  "Gen 1:2 first 'was' NOT italic (H1961 hayah present)"  GEN 1 2 was   0
assert_match_word "H7363 Gen 1:2 highlights 'moved'"                  GEN 1 2 H7363 moved
assert_match_word "H5921 Gen 1:2 highlights 'upon'"                   GEN 1 2 H5921 upon
assert_occ_count  "H7363 (rāchaph) ≥ 2"                               H7363 2
assert_occ_count  "H5921 (ʿal/upon) ≥ 2000"                           H5921 2000

section "Deuteronomy 32:11 — H5921 'over' (cross-check)"
assert_strongs "Deu 32:11 'over' = H5921"  DEU 32 11 over H5921

section "Genesis 1:20 — additional H5921 cross-check (above = H5921)"
assert_strongs    "Gen 1:20 'above' = H5921 (ʿal)"         GEN 1 20 above     H5921
assert_strongs    "Gen 1:20 'firmament' = H7549 (rāqîaʿ)"  GEN 1 20 firmament H7549
assert_match_word "H5921 Gen 1:20 highlights 'above'"      GEN 1 20 H5921     above

# ─── G5485 MISSING OCCURRENCES — ALL 10 FIXED ──────────────────────────────────
# These verses had *word{} (italic, no tag) where G5485 (charis) was present.
# Fixed by removing italic marker and adding {G5485}.
section "Luke 4:22 — 'gracious words' (χάριτος = G5485) [BLB fix]"
assert_strongs    "Luk 4:22 'gracious' = G5485 (χάριτος)"          LUK 4 22 gracious G5485
assert_italic     "Luk 4:22 'gracious' NOT italic"                  LUK 4 22 gracious 0
assert_match_word "G5485 Luk 4:22 highlights 'gracious'"            LUK 4 22 G5485 gracious

section "Luke 6:32-34 — 'what thank have ye?' (χάρις = G5485) [BLB fix]"
assert_strongs    "Luk 6:32 'thank' = G5485 (χάρις)"               LUK 6 32 thank G5485
assert_strongs    "Luk 6:33 'thank' = G5485 (χάρις)"               LUK 6 33 thank G5485
assert_strongs    "Luk 6:34 'thank' = G5485 (χάρις)"               LUK 6 34 thank G5485
assert_italic     "Luk 6:32 'thank' NOT italic"                     LUK 6 32 thank 0
assert_italic     "Luk 6:33 'thank' NOT italic"                     LUK 6 33 thank 0
assert_italic     "Luk 6:34 'thank' NOT italic"                     LUK 6 34 thank 0
assert_match_word "G5485 Luk 6:32 highlights 'thank'"               LUK 6 32 G5485 thank
assert_match_word "G5485 Luk 6:33 highlights 'thank'"               LUK 6 33 G5485 thank
assert_match_word "G5485 Luk 6:34 highlights 'thank'"               LUK 6 34 G5485 thank

section "Acts 2:47 — 'having favour' (χάριν = G5485) [BLB fix]"
assert_strongs    "Act 2:47 'favour' = G5485"                       ACT 2 47 favour G5485
assert_italic     "Act 2:47 'favour' NOT italic"                    ACT 2 47 favour 0
assert_match_word "G5485 Act 2:47 highlights 'favour'"              ACT 2 47 G5485 favour

section "Acts 7:10 — 'gave him favour' (χάριν = G5485) [BLB fix]"
assert_strongs    "Act 7:10 'favour' = G5485"                       ACT 7 10 favour G5485
assert_italic     "Act 7:10 'favour' NOT italic"                    ACT 7 10 favour 0
assert_match_word "G5485 Act 7:10 highlights 'favour'"              ACT 7 10 G5485 favour
assert_strongs    "Act 7:10 'wisdom' = G4678"                       ACT 7 10 wisdom G4678

section "Acts 7:46 — 'found favour' (χάριν = G5485) [BLB fix]"
assert_strongs    "Act 7:46 'favour' = G5485"                       ACT 7 46 favour G5485
assert_italic     "Act 7:46 'favour' NOT italic"                    ACT 7 46 favour 0
assert_match_word "G5485 Act 7:46 highlights 'favour'"              ACT 7 46 G5485 favour

section "Acts 24:27 — 'shew a pleasure' (χάριτας = G5485) [BLB fix]"
assert_strongs    "Act 24:27 'pleasure' = G5485 (χάριτας)"          ACT 24 27 pleasure G5485
assert_italic     "Act 24:27 'a' NOT italic (part of G5485 phrase)"  ACT 24 27 a 0
assert_match_word "G5485 Act 24:27 highlights 'pleasure'"           ACT 24 27 G5485 pleasure

section "Acts 25:3 — 'desired favour' (χάριν = G5485) [BLB fix]"
assert_strongs    "Act 25:3 'favour' = G5485"                       ACT 25 3 favour G5485
assert_italic     "Act 25:3 'favour' NOT italic"                    ACT 25 3 favour 0
assert_match_word "G5485 Act 25:3 highlights 'favour'"              ACT 25 3 G5485 favour

section "Romans 6:17 — 'God be thanked' (χάρις G5485 + θεῷ G2316)"
# χάρις (G5485) = thanks/grace → 'thanked'; θεῷ (G2316) = God → 'God'
# Manual fix applied: bbli incorrectly groups "God be thanked," as one phrase under G2316
assert_strongs    "Rom 6:17 'God' = G2316 (theos)"                  ROM 6 17 god     G2316
assert_strongs    "Rom 6:17 'thanked' = G5485 (charis)"             ROM 6 17 thanked G5485
assert_italic     "Rom 6:17 'thanked' NOT italic"                   ROM 6 17 thanked 0
assert_match_word "G5485 Rom 6:17 highlights 'thanked'"             ROM 6 17 G5485 thanked

# ─── ADDITIONAL G5485 OCCURRENCES (BROADER COVERAGE) ────────────────────────
section "Acts 4:33 — great grace (G5485)"
assert_strongs    "Act 4:33 'grace' = G5485"                        ACT 4 33 grace G5485
assert_match_word "G5485 Act 4:33 highlights 'grace'"               ACT 4 33 G5485 grace

section "Titus 2:11 — grace of God (G5485) [key grace passage]"
assert_strongs    "Tit 2:11 'grace' = G5485"                        TIT 2 11 grace G5485
assert_match_word "G5485 Tit 2:11 highlights 'grace'"               TIT 2 11 G5485 grace

section "Galatians 1:15 — called by his grace (G5485)"
assert_strongs    "Gal 1:15 'grace' = G5485"                        GAL 1 15 grace G5485
assert_match_word "G5485 Gal 1:15 highlights 'grace'"               GAL 1 15 G5485 grace

section "Romans 6:1 — shall we continue in sin that grace may abound (G5485)"
assert_strongs    "Rom 6:1 'grace' = G5485"                         ROM 6 1 grace G5485
assert_match_word "G5485 Rom 6:1 highlights 'grace'"                ROM 6 1 G5485 grace

# ─── SYSTEMATIC FIX REGRESSION TESTS ────────────────────────────────────────
section "Genesis 2:7 — soul H5315 (misplacement fix: was on 'a', now on 'soul')"
assert_strongs "Gen 2:7 'soul' = H5315 (nefesh)"    GEN 2 7 soul  H5315
assert_strongs "Gen 2:7 'living' = H2416 (chayyah)"  GEN 2 7 living H2416
assert_italic  "Gen 2:7 'soul' NOT italic"            GEN 2 7 soul  0

section "Genesis 6:8 — grace H2580 (OT grace = chen)"
assert_strongs "Gen 6:8 'grace' = H2580 (chen)"    GEN 6 8 grace H2580
assert_italic  "Gen 6:8 'grace' NOT italic"          GEN 6 8 grace 0
assert_match_word "H2580 Gen 6:8 highlights 'grace'" GEN 6 8 H2580 grace

section "Psalm 23:4 — evil H7451, walk H1980"
assert_strongs "Psa 23:4 'evil' = H7451 (ra)"  PSA 23 4 evil H7451
assert_strongs "Psa 23:4 'walk' = H1980 (halak)" PSA 23 4 walk H1980
assert_italic  "Psa 23:4 'evil' NOT italic"     PSA 23 4 evil 0

section "Deuteronomy 6:5 — all H3605, soul H5315"
assert_strongs "Deu 6:5 'soul' = H5315"         DEU 6 5 soul  H5315
assert_strongs "Deu 6:5 'all' = H3605 (kol)"    DEU 6 5 all   H3605
assert_strongs "Deu 6:5 'heart' = H3824"         DEU 6 5 heart H3824

section "Genesis 23:10 — children H1121 (misplacement fix: was on 'of')"
assert_strongs "Gen 23:10 'children' = H1121"    GEN 23 10 children H1121
assert_italic  "Gen 23:10 'children' NOT italic" GEN 23 10 children 0

section "Genesis 3:6 — eat H398"
assert_strongs "Gen 3:6 'eat' = H398 (akal)"    GEN 3 6 eat H398
assert_italic  "Gen 3:6 'eat' NOT italic"        GEN 3 6 eat 0

section "Luke 6:27 — you G4771 (systematic 2nd-pass fix)"
assert_strongs "Luk 6:27 'you' tagged G4771 (final instance)" LUK 6 27 enemies G2190

section "Psalm 139:14 — soul H5315"
assert_strongs "Psa 139:14 'soul' = H5315"      PSA 139 14 soul H5315

section "Proverbs 8:13 — evil H7451 (cross-check)"
assert_strongs "Pro 8:13 'evil' = H7451"         PRO 8 13 evil H7451

section "Occurrence counts after systematic fixes"
assert_occ_count "H5315 (nefesh/soul) ≥ 400"     H5315  400
assert_occ_count "H1121 (ben/son) ≥ 1200"         H1121 1200
assert_occ_count "H2580 (chen/grace) ≥ 25"        H2580   25
assert_occ_count "H7451 (ra/evil) ≥ 400"          H7451  400
assert_occ_count "G4771 (humas/you) ≥ 400"        G4771  400

# ─── SUMMARY ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
echo "  PASSED:  $PASS"
echo "  FAILED:  $FAIL"
echo "  SKIPPED: $SKIP  (no text_tagged)"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo ""
  echo "Failed tests:"
  for f in "${FAILURES[@]}"; do echo "  ✗ $f"; done
fi

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "All tests passed."
else
  echo "$FAIL test(s) FAILED."
  exit 1
fi

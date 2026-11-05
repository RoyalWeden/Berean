#!/usr/bin/env python3
"""Independent HOLDOUT set (spec §10.2) — written 2026-10-28 AFTER the Phase 1–2 rules and
before any Phase 3 tuning; frozen by SHA-256 in HOLDOUT.lock. Not used to write router rules,
prompts, follow-up rules or ranking. Same case schema as cases.jsonl; ids start with X.

Gold refs / Strong's ids are validated against data/*.db by validate_cases.py (run with
--file holdout.jsonl). Topical gold sets are the author's judgement → human_review=True.
"""
import json
from pathlib import Path

OUT = Path(__file__).with_name('holdout2.jsonl')
cases = []

def C(id, section, category, q, *, on=False, deep=False, hist=None, intent='verses', gold=None, gold_any=None,
      strongs=None, mustnot=None, rules=None, crit=None, review=False, tabref=None, tab=False):
    hist = hist or []
    cases.append({
        'id': id, 'section': section, 'category': category, 'commentary_expected': on,
        'mode': ('deep' if deep else 'commentary') if on else ('deep-off' if deep else 'passages'),
        'switches': {'commentary': on, 'deepSearch': deep, 'tabContext': tab}, 'question': q,
        'user_turns': [t[1] for t in hist if t[0] == 'user'] + [q], 'assistant_turns': [t[1] for t in hist if t[0] == 'assistant'],
        'history': [{'role': r, 'content': c} for r, c in hist], 'tab': tabref, 'fixture_data': {},
        'expected_intent': intent, 'expected_tools': [], 'gold_references': gold or [], 'gold_any': gold_any or [],
        'gold_strongs': strongs or [], 'must_include': [], 'must_not_include': mustnot or [], 'expected_count': None,
        'cover_groups': [], 'scoring_rules': rules or [], 'critical_failure_flags': crit or ['fabricated_ref', 'fabricated_strongs'],
        'human_review': review, 'platform': 'mac', 'static_check': None, 'multi_turn': bool(hist),
    })

NC = ['no_unsolicited_commentary']
M, L, R, S = 'YM', 'YL', 'YR', 'YS'
h = lambda *t: list(t)
# ── Follow-ups (OFF), phrasings not used anywhere in rule development ──
C('Y001', M, 'lang', 'how about in Greek', hist=h(('user', 'the Hebrew word for truth'), ('assistant', "Strong's H571 emeth")), intent='strongs', strongs=['G225'], rules=['strongs_card_or_list'] + NC)
C('Y002', M, 'lang', 'Greek equivalent?', hist=h(('user', 'the Hebrew word for salvation'), ('assistant', "Strong's H3444 yeshuwah")), intent='strongs', strongs=['G4991'], rules=['strongs_card_or_list'] + NC)
C('Y003', M, 'lang', 'switch to the Hebrew', hist=h(('user', 'the Greek word for holy'), ('assistant', "Strong's G40 hagios")), intent='strongs', strongs=['H6944', 'H6918'], rules=['strongs_card_or_list'] + NC)
C('Y004', M, 'occ-book', 'is it used in Acts?', hist=h(('user', 'the Greek word for church'), ('assistant', "Strong's G1577 ekklesia")), intent='strongs_occurrences', strongs=['G1577'], rules=['strongs_card_or_list', 'scope_book:ACT'] + NC)
C('Y005', M, 'occ-all', 'list every verse with it', hist=h(('user', 'H7676'), ('assistant', "Strong's H7676 shabbath")), intent='strongs_occurrences', strongs=['H7676'], rules=['strongs_card_or_list'] + NC)
C('Y006', M, 'swap-topic', 'same question but about justice', hist=h(('user', 'the Hebrew word for mercy'), ('assistant', "Strong's H2617 cheçed")), intent='strongs', strongs=['H4941', 'H6664'], rules=['strongs_card_or_list'] + NC)
C('Y007', M, 'swap-topic', 'ok now patience', hist=h(('user', 'verses about humility'), ('assistant', 'Passages: Micah 6:8; James 4:10')), gold_any=['JAS 1:4', 'ROM 5:3', 'GAL 5:22', 'JAS 5:7', 'HEB 10:36'], rules=['any_gold_top5'] + NC, review=True)
C('Y008', M, 'more', 'a few more please', hist=h(('user', 'verses about the resurrection of the dead'), ('assistant', 'Passages: 1 Corinthians 15:42; John 11:25')), gold_any=['DAN 12:2', 'JHN 5:29', '1TH 4:16', 'ACT 24:15', 'REV 20:12'], mustnot=['1CO 15:42', 'JHN 11:25'], rules=['any_gold_top5'] + NC, review=True)
C('Y009', M, 'limit', 'just one', hist=h(('user', 'verses about the rainbow covenant'), ('assistant', 'Passages: Genesis 9:13; Genesis 9:16')), gold_any=['GEN 9:13', 'GEN 9:16', 'GEN 9:12'], rules=['any_gold_top1'] + NC)
C('Y010', M, 'ordinal', 'open the third one', hist=h(('user', 'verses about the shema'), ('assistant', 'Passages: Deuteronomy 6:4; Mark 12:29; Deuteronomy 11:13')), gold=['DEU 11:13'], rules=['gold_top3'] + NC)
C('Y011', M, 'context', 'read me the chapter around the second one', hist=h(('user', 'verses about faith'), ('assistant', 'Passages: Hebrews 11:1; Romans 10:17')), gold=['ROM 10:17'], rules=['gold_top5'] + NC)
C('Y012', M, 'corpus', 'what does Enoch say about it', hist=h(('user', 'verses about the flood'), ('assistant', 'Passages: Genesis 7:17')), gold_any=['enoch:ENO 10:2', 'enoch:ENO 89:3', 'enoch:ENO 65:1'], rules=['any_gold_top5', 'scope_text:enoch'] + NC, review=True)
C('Y013', M, 'lxx', 'and in the Greek Old Testament?', hist=h(('user', 'Isaiah 7:14'), ('assistant', 'Passages: Isaiah 7:14')), gold_any=['lxx:ISA 7:14'], rules=['any_gold_top3'] + NC)
C('Y014', M, 'scope-drop', 'drop the restriction', hist=h(('user', 'only in Proverbs: verses about wisdom'), ('assistant', 'Passages: Proverbs 4:7')), gold_any=['PRO 4:7', 'JAS 1:5', 'PSA 111:10', 'JOB 28:28'], rules=['any_gold_top5'] + NC, review=True)
C('Y015', M, 'compare-ord', 'contrast the first two', hist=h(('user', 'the word for love'), ('assistant', 'Strong\'s H157 · G25 · G26')), intent='strongs', strongs=['H157', 'G25'], rules=['strongs_card_or_list'] + NC)
C('Y016', M, 'table-those', 'break those down word by word', hist=h(('user', 'Psalm 23:1-2'), ('assistant', 'Passages: Psalms 23:1-2')), intent='word_tags', gold=['PSA 23:1'], rules=['word_tag_table'] + NC)
C('Y017', M, 'verify', 'is that really the right number?', hist=h(('user', 'the Greek word for hope'), ('assistant', "Strong's G1680 elpis")), intent='strongs', strongs=['G1680'], rules=['strongs_card_or_list'] + NC)
C('Y018', M, 'retry', 'again please', hist=h(('user', 'verses about the year of release'), ('assistant', 'Something went wrong')), gold_any=['DEU 15:9', 'DEU 15:1', 'DEU 31:10'], rules=['any_gold_top5'] + NC, review=True)
C('Y019', M, 'exclude', "more, but skip anything from Psalms", hist=h(('user', 'verses about praise'), ('assistant', 'Passages: Psalms 150:6; Psalms 100:4')), gold_any=['HEB 13:15', 'EPH 5:19', 'REV 19:5', '1PE 2:9'], mustnot=['PSA 150:6', 'PSA 100:4'], rules=['any_gold_top5'] + NC, review=True)
C('Y020', M, 'nt-only', 'same thing, NT only', hist=h(('user', 'verses about the Passover'), ('assistant', 'Passages: Exodus 12:11; Leviticus 23:5')), gold_any=['1CO 5:7', 'LUK 22:15', 'JHN 19:14', 'MAT 26:17'], rules=['any_gold_top5', 'scope_testament:NT'] + NC, review=True)
# ── Word studies (OFF), new phrasings ──
C('Y030', L, 'english', 'what is the Greek for peace', intent='strongs', strongs=['G1515'], rules=['strongs_card_or_list'] + NC)
C('Y031', L, 'english', 'Hebrew term behind "covenant"', intent='strongs', strongs=['H1285'], rules=['strongs_card_or_list'] + NC)
C('Y032', L, 'english', 'which Greek word means grace', intent='strongs', strongs=['G5485'], rules=['strongs_card_or_list'] + NC)
C('Y033', L, 'english', 'original word for "repent" in Acts 2:38', intent='strongs', strongs=['G3340'], rules=['strongs_card_or_list'] + NC)
C('Y034', L, 'english', 'look up the lexicon entry for joy', intent='strongs', strongs=['G5479', 'H8057'], rules=['strongs_card_or_list'] + NC)
C('Y035', L, 'translit', 'what does "chen" mean', intent='strongs', strongs=['H2580'], rules=['strongs_card_or_list'] + NC)
C('Y036', L, 'translit', 'define pneuma', intent='strongs', strongs=['G4151'], rules=['strongs_card_or_list'] + NC)
C('Y037', L, 'translit', 'yeshua as a word', intent='strongs', strongs=['H3444', 'H3442'], rules=['strongs_card_or_list'] + NC)
C('Y038', L, 'script', 'ἀγάπη', intent='strongs', strongs=['G26'], rules=['strongs_card_or_list'] + NC)
C('Y039', L, 'script', 'ברית', intent='strongs', strongs=['H1285'], rules=['strongs_card_or_list'] + NC)
C('Y040', L, 'id', 'Strong\'s H1285 please', intent='strongs', strongs=['H1285'], rules=['strongs_card'] + NC)
C('Y041', L, 'id-occ', 'how often does G26 occur in 1 John', intent='strongs_occurrences', strongs=['G26'], rules=['strongs_card_or_list', 'scope_book:1JN'] + NC)
C('Y042', L, 'table', 'interlinear for Genesis 1:3', intent='word_tags', gold=['GEN 1:3'], rules=['word_tag_table'] + NC)
C('Y043', L, 'table', 'tag each word of Romans 6:23 with its Strong\'s number', intent='word_tags', gold=['ROM 6:23'], rules=['word_tag_table'] + NC)
C('Y044', L, 'compare', 'difference between H7307 and H5315', intent='strongs', strongs=['H7307', 'H5315'], rules=['strongs_card_or_list'] + NC)
C('Y045', L, 'nonexistent', 'H9500', intent='strongs', rules=['no_card_for_false_number'], crit=['fabricated_strongs'])
# ── References / scope (OFF) ──
C('Y050', R, 'ref', 'Jas 1:27', intent='reference', gold=['JAS 1:27'], rules=['rank1'])
C('Y051', R, 'ref', 'show me Ruth chapter 1 verse 16', intent='reference', gold=['RUT 1:16'], rules=['gold_top3'])
C('Y052', S, 'apocrypha', 'Tobit only: verses about almsgiving', gold_any=['TOB 4:7', 'TOB 12:8', 'TOB 4:10', 'TOB 12:9'], rules=['any_gold_top5'] + NC, review=True)
C('Y053', S, 'negation', 'verses about fear that are not about fearing God', gold_any=['ISA 41:10', '2TI 1:7', 'JOS 1:9', 'PSA 23:4', '1JN 4:18'], mustnot=['PRO 9:10', 'PRO 1:7', 'ECC 12:13'], rules=['any_gold_top5'] + NC, review=True)

OUT.write_text(''.join(json.dumps(c, ensure_ascii=False) + '\n' for c in cases))
off = sum(1 for c in cases if not c['commentary_expected'])
print(f'{len(cases)} holdout2 cases → {OUT.name} ({off} commentary OFF)')

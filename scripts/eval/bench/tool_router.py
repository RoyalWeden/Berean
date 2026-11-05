#!/usr/bin/env python3
"""Layer E — tool-use simulation. Each model gets the SAME router prompt (read-only tool catalogue)
and must return one JSON tool call; a deterministic rule-based router is scored on the same cases.

usage: tool_router.py <model|RULES> [think_false]   → out/E-<model>.jsonl
"""
import json, re, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CASES = [json.loads(l) for l in open(HERE / 'cases.jsonl')]
CASES = [c for c in CASES if not c.get('static_check')]

TOOLS = """You route a Bible-study request to exactly ONE read-only tool. Tools:
- get_passage {"refs": ["Book C:V" or "Book C" ...], "translation": "kjv"|"lxx"|null} — show specific references
- get_context {"ref": "Book C:V", "around": n} — verses surrounding a reference
- search_scripture {"query": "...", "book": null|"Book", "testament": null|"OT"|"NT", "text": null|"jubilees"|"enoch"|"lxx", "exclude": [], "limit": n} — find passages about a topic or phrase
- lookup_strongs {"id": "G1234"|"H1234"|null, "word": "english word or transliteration"|null} — one lexicon entry
- strongs_occurrences {"id": "G1234"|"H1234", "book": null|"Book"} — where a Strong's number occurs
- get_word_tags {"ref": "Book C:V"} — the Strong's number attached to each word of a verse
- search_lexicon {"term": "...", "language": "greek"|"hebrew"|null} — entries whose definitions match a term
- compare_translations {"ref": "Book C:V", "translations": ["kjv","lxx"]}
- cross_refs {"ref": "Book C:V", "limit": n}
- quote_lookup {"ref": "Book C:V", "direction": "forward"|"reverse"} — what a verse quotes / what quotes it
- search_notes {"query": "..."} — the user's own notes
- search_videos {"query": "..."} — the user's saved YouTube library
- read_tab {} — the tab the user has open
- none {"reason": "refuse"|"clarify"|"history"|"unsupported"} — no tool fits or the request must be declined
Never invent references or Strong's numbers you are not sure of; use word instead of id when unsure.
Reply with JSON only: {"tool": "<name>", "args": {...}}"""

def prompt_for(c):
    hist = '\n'.join(f"{t['role']}: {t['content'][:400]}" for t in c['history'][-6:])
    tab = f"\nOpen tab: {json.dumps(c['tab'])}" if c['switches']['tabContext'] and c['tab'] else ''
    return f"{TOOLS}\n\n{'Conversation so far:' + chr(10) + hist + chr(10) if hist else ''}{tab}\nRequest: {c['question'][:1500]}"

def call(model, prompt, think_false):
    body = {'model': model, 'prompt': prompt, 'stream': False, 'format': 'json', 'keep_alive': '15m',
            'options': {'num_ctx': 8192, 'num_predict': 256, 'temperature': 0}}
    if think_false: body['think'] = False
    req = urllib.request.Request('http://localhost:11434/api/generate', json.dumps(body).encode(), {'Content-Type': 'application/json'})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    return data['response'], (time.time() - t0) * 1000

REF = re.compile(r'\b([1-3]?\s?[A-Za-z]+\.?)\s+(\d+)(?::(\d+))?')
BOOKISH = re.compile(r'\b(genesis|gen|exodus|exod|leviticus|numbers|deut\w*|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|job|psalms?|proverbs|ecclesiastes|qoheleth|song of solomon|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|jn|acts|romans|rom|corinthians|galatians|ephesians|philippians|phillipians|colossians|thessalonians|timothy|tim|titus|philemon|hebrews|james|peter|jude|revelation|rev|enoch|jubilees|genisis|testament of levi)\b\.?\s*\d', re.I)

def rules_router(c):
    q = c['question'].lower()
    if re.search(r'\b(save|delete|send|upload)\b.*\b(note|notes)\b|hidden system prompt|telling me personally|make up a', q): return {'tool': 'none', 'args': {'reason': 'refuse'}}
    if re.search(r'\bnotes?\b', q) and re.search(r'\b(my|i have|i wrote|written)\b', q): return {'tool': 'search_notes', 'args': {'query': q}}
    if re.search(r'\bvideo\b', q): return {'tool': 'search_videos', 'args': {'query': q}}
    if re.search(r'this (chapter|note|video|verse|word)', q) or (c['switches']['tabContext'] and c['tab']): return {'tool': 'read_tab', 'args': {}}
    if re.search(r'\b(quote|quoted)\b', q) and BOOKISH.search(q): return {'tool': 'quote_lookup', 'args': {}}
    if re.search(r"cross.?ref|related passages|connected to|linked to|passage chain", q): return {'tool': 'cross_refs', 'args': {}}
    if re.search(r"strong'?s numbers? (for|in)|each word|word.by.word|no strong'?s number|morphology|tags", q): return {'tool': 'get_word_tags', 'args': {}}
    if re.search(r'\b[gh]-?0*\d{1,5}\b', q):
        return {'tool': 'strongs_occurrences' if re.search(r'occur|how many|where is|used (in|for)', q) else 'lookup_strongs', 'args': {}}
    if re.search(r'compare .*\b(kjv|lxx|brenton|septuagint)\b|\b(kjv|lxx)\b and (the )?\b(kjv|lxx|brenton)\b', q): return {'tool': 'compare_translations', 'args': {}}
    if re.search(r"(greek|hebrew) (word|entries|words)|the word for|definition|strong'?s for|chesed|agape|[Ͱ-Ͽ֐-׿]", q): return {'tool': 'lookup_strongs', 'args': {}}
    if BOOKISH.search(q) and len(q.split()) <= 9: return {'tool': 'get_passage', 'args': {}}
    if re.search(r'^(what did (we|i)|show me the verse we)', q): return {'tool': 'none', 'args': {'reason': 'history'}}
    return {'tool': 'search_scripture', 'args': {'query': q}}

def main():
    model = sys.argv[1]; think_false = len(sys.argv) > 2
    out = HERE / 'out' / f"E-{model.replace(':', '_').replace('/', '_')}.jsonl"
    with out.open('w') as f:
        for c in CASES:
            exp = c['expected_tools'] or ['none']
            if model == 'RULES':
                parsed, raw, ms = rules_router(c), '', 0
            else:
                raw, ms = None, 0
                try:
                    raw, ms = call(model, prompt_for(c), think_false)
                    parsed = json.loads(raw)
                except Exception as e:
                    parsed = None; raw = raw or f'ERROR {e}'
            tool = parsed.get('tool') if isinstance(parsed, dict) else None
            args = parsed.get('args', {}) if isinstance(parsed, dict) else {}
            ok_tool = tool in exp
            # argument checks against DB-validated gold
            arg_ok = None
            if tool in ('lookup_strongs', 'strongs_occurrences') and isinstance(args, dict) and args.get('id'):
                sid = re.sub(r'^([GH])0*', r'\1', str(args['id']).upper().replace('-', ''))
                arg_ok = sid in c['gold_strongs'] if c['gold_strongs'] else False
            fabricated = None
            if tool in ('lookup_strongs', 'strongs_occurrences') and isinstance(args, dict) and args.get('id') and c['gold_strongs']:
                fabricated = not arg_ok
            f.write(json.dumps({'id': c['id'], 'model': model, 'expected': exp, 'tool': tool, 'args': args, 'valid_json': parsed is not None,
                                'tool_ok': ok_tool, 'strongs_arg_ok': arg_ok, 'strongs_wrong_id': fabricated, 'ms': round(ms), 'raw': (raw or '')[:500]}) + '\n')
    rows = [json.loads(l) for l in open(out)]
    print(f"{model}: json {sum(r['valid_json'] for r in rows)}/{len(rows)}  tool {sum(r['tool_ok'] for r in rows)}/{len(rows)}  "
          f"strongs-id ok {sum(1 for r in rows if r['strongs_arg_ok'])}/{sum(1 for r in rows if r['strongs_arg_ok'] is not None)}  "
          f"median ms {sorted(r['ms'] for r in rows)[len(rows)//2]}")

if __name__ == '__main__':
    main()

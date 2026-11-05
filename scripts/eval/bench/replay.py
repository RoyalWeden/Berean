#!/usr/bin/env python3
"""Layers C/D — frozen-input replay. The commentary and relevance-prune prompts recorded from the
baseline (llama3.1) end-to-end run are sent UNCHANGED to every candidate, so every model sees the
identical retrieved records. Production generation settings are used (format json, num_ctx 16384,
num_predict 512, temperature 0.3); think:false only for thinking-capable models.

usage: replay.py <model> [think_false] [runs]   → out/D-<model>[-rN].jsonl
"""
import json, re, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CASES = {c['id']: c for c in map(json.loads, open(HERE / 'cases.jsonl'))}
PROMPTS = [json.loads(l) for l in open(HERE / 'out' / 'prompts.jsonl')]
SUBSET = [p for p in PROMPTS if p['kind'] in ('commentary', 'prune')]

def call(model, prompt, think_false):
    body = {'model': model, 'prompt': prompt, 'stream': False, 'format': 'json', 'keep_alive': '15m',
            'options': {'num_ctx': 16384, 'num_predict': 512, 'temperature': 0.3}}
    if think_false: body['think'] = False
    req = urllib.request.Request('http://localhost:11434/api/generate', json.dumps(body).encode(), {'Content-Type': 'application/json'})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    return data['response'], (time.time() - t0) * 1000, data.get('eval_count'), data.get('eval_duration')

def supplied_keys(prompt):
    return set(re.findall(r'\b([1-3]?[A-Z]{2,3}) (\d+):(\d+)', prompt))

def main():
    model = sys.argv[1]; think_false = len(sys.argv) > 2 and sys.argv[2] == 'think_false'
    runs = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    for run in range(1, runs + 1):
        out = HERE / 'out' / f"D-{model.replace(':', '_').replace('/', '_')}{'' if runs == 1 else f'-r{run}'}.jsonl"
        with out.open('w') as f:
            seen = set()
            for p in SUBSET:
                key = (p['id'], p['kind'])
                if key in seen: continue
                seen.add(key)
                c = CASES[p['id']]
                rec = {'id': p['id'], 'kind': p['kind'], 'model': model, 'run': run}
                try:
                    raw, ms, ec, ed = call(model, p['prompt'], think_false)
                    rec.update(ms=round(ms), eval_count=ec, tok_s=round(ec / (ed / 1e9), 1) if ec and ed else None, raw=raw[:3000])
                    obj = json.loads(raw); rec['valid_json'] = True
                except Exception as e:
                    rec.update(valid_json=False, error=str(e)[:200]); f.write(json.dumps(rec) + '\n'); continue
                sup = supplied_keys(p['prompt'])
                if p['kind'] == 'commentary':
                    pv = obj.get('perVerse') or {}
                    keys = set(re.findall(r'\b([1-3]?[A-Z]{2,3}) (\d+):(\d+)', ' '.join(pv.keys()))) if isinstance(pv, dict) else set()
                    rec['perverse_keys_not_supplied'] = sorted(' '.join([b, f'{ch}:{v}']) for b, ch, v in keys - sup)
                    summ = obj.get('summary') or ''
                    rec['summary'] = summ[:1200]
                    rec['summary_words'] = len(summ.split())
                    rec['schema_ok'] = isinstance(obj.get('summary'), str) and isinstance(pv, dict)
                else:
                    irr = obj.get('irrelevant') or []
                    irr_keys = set(re.findall(r'\b([1-3]?[A-Z]{2,3}) (\d+):(\d+)', ' '.join(map(str, irr))))
                    gold = set()
                    for g in c['gold_references'] + c['gold_any'] + [x for grp in c['cover_groups'] for x in grp]:
                        if ':' in g.split(' ')[0]: continue
                        b, cv = g.split(' '); ch, v = cv.split(':'); gold.add((b, ch, v))
                    rec['pruned'] = len(irr_keys); rec['pruned_gold'] = sorted(' '.join([b, f'{ch}:{v}']) for b, ch, v in (irr_keys & gold & sup))
                    rec['pruned_not_supplied'] = len(irr_keys - sup)
                    rec['schema_ok'] = isinstance(obj.get('irrelevant'), list)
                f.write(json.dumps(rec) + '\n')
        print(f'{model} run {run}: {out.name}')

if __name__ == '__main__':
    main()

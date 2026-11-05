#!/bin/zsh
# Runs after run_all.sh finishes. Evaluation only; nothing here touches the main checkout.
cd /Users/roywe/Berean-ai-bench
B=scripts/eval/bench
while ! grep -q ALLDONE $B/out/run_all.log; do sleep 60; done
unload() { curl -s localhost:11434/api/generate -d "{\"model\":\"$1\",\"keep_alive\":0}" > /dev/null; }
THINKERS=(qwen3.5:0.8b qwen3.5:2b-q4_K_M qwen3.5:4b-q4_K_M qwen3.5:9b-q4_K_M gemma4:e2b-it-qat gemma4:12b-it-qat)
ALL=(llama3.1:latest gemma3:4b llama3.2:3b ministral-3:3b ${THINKERS[@]})
tf() { [[ ${THINKERS[(ie)$1]} -le ${#THINKERS} ]] && echo think_false; }
echo "== E router $(date +%T)"
for M in $ALL; do python3 $B/tool_router.py $M $(tf $M); unload $M; done
echo "== D replay $(date +%T)"
for M in $ALL; do python3 $B/replay.py $M "$(tf $M)" 1; unload $M; done
echo "== D stability x3 $(date +%T)"
for M in llama3.1:latest qwen3.5:4b-q4_K_M qwen3.5:2b-q4_K_M gemma4:e2b-it-qat; do python3 $B/replay.py $M "$(tf $M)" 3; unload $M; done
echo "== as-is thinking (production settings, no think:false) $(date +%T)"
for M in qwen3.5:4b-q4_K_M gemma4:e2b-it-qat; do
  unset BENCH_THINK; BENCH_TAG=asis BENCH_CASES=A19,B04,B10,B40,C22,C38,C41,D07,F06,H01,H02,I11,K01,K03,S02 BENCH_LAYER=F BENCH_MODEL=$M npx vitest run --config $B/bench.config.ts > $B/out/log-asis-$M.txt 2>&1; unload $M
done
echo "== mode matrix llama3.1 $(date +%T)"
MM=A02,B04,B40,C38,D16,F01,F13,G11,H01,I16,K03,E02
for SW in 0,0,0 0,0,1 0,1,0 0,1,1 1,0,0 1,0,1 1,1,0 1,1,1; do
  BENCH_SWITCHES=$SW BENCH_TAG=mm${SW//,/} BENCH_CASES=$MM BENCH_LAYER=F BENCH_MODEL=llama3.1:latest npx vitest run --config $B/bench.config.ts > $B/out/log-mm-$SW.txt 2>&1
done
unload llama3.1:latest
echo POSTDONE $(date +%T)

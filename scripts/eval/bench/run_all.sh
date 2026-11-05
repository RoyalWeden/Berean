#!/bin/zsh
# Sequential layer-F runs, one model at a time (shares one GPU). Evaluation only.
cd /Users/roywe/Berean-ai-bench
run() { # model think
  local M=$1 T=$2
  echo "=== $M think=$T start $(date +%T)"
  if [[ $T == false ]]; then export BENCH_THINK=false; else unset BENCH_THINK; fi
  BENCH_LAYER=F BENCH_MODEL=$M npx vitest run --config scripts/eval/bench/bench.config.ts > scripts/eval/bench/out/log-$M.txt 2>&1
  curl -s localhost:11434/api/ps > "scripts/eval/bench/out/ps-${M//[:\/]/_}.json"
  echo "=== $M done $(date +%T)"
  curl -s localhost:11434/api/generate -d "{\"model\":\"$M\",\"keep_alive\":0}" > /dev/null
}
BENCH_SAVE_PROMPTS=1 run llama3.1:latest default
unset BENCH_SAVE_PROMPTS
run qwen3.5:2b-q4_K_M false
run qwen3.5:4b-q4_K_M false
run llama3.2:3b default
run gemma3:4b default
run ministral-3:3b default
run gemma4:e2b-it-qat false
run qwen3.5:0.8b false
run qwen3.5:9b-q4_K_M false
run gemma4:12b-it-qat false
echo ALLDONE

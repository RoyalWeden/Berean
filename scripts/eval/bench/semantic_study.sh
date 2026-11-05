#!/bin/zsh
# Phase 3 semantic-retrieval study (spec §4.5). Evaluation only; indexes go to electron/db-generated/
# (gitignored). Runs after the holdout model run so GPU timing isn't shared.
cd /Users/roywe/Berean-ai-upgrade
B=scripts/eval/bench; G=electron/db-generated
while pgrep -f "BENCH_FILE=holdout.jsonl" >/dev/null || pgrep -f "vitest run --config scripts/eval/bench/bench.config.ts" >/dev/null; do sleep 30; done
echo "== build S2 nomic+prefix $(date +%T)"
( time BEREAN_EMBED_DB=$G/emb_nomic_prefix.db BEREAN_EMBED_DOC_PREFIX='search_document: ' node scripts/build-embedding-index.js kjva ) > $B/out/build-S2.log 2>&1
echo "== build S3 mxbai $(date +%T)"
( time BEREAN_EMBED_DB=$G/emb_mxbai.db BEREAN_EMBED_MODEL=mxbai-embed-large BEREAN_EMBED_QUERY_PREFIX='Represent this sentence for searching relevant passages: ' node scripts/build-embedding-index.js kjva ) > $B/out/build-S3.log 2>&1
ls -la $G >> $B/out/build-S3.log
for S in S0 S1 S2 S3; do
  case $S in
    S0) DB=$G/none.db ;;
    S1) DB=$G/verse_embeddings.db ;;
    S2) DB=$G/emb_nomic_prefix.db ;;
    S3) DB=$G/emb_mxbai.db ;;
  esac
  echo "== layer A $S $(date +%T)"
  BEREAN_EMBED_DB=$DB BENCH_LAYER=A BENCH_MODEL=llama3.1:latest BENCH_TAG=sem$S BENCH_SECTIONS=6B,6H,8,6I npx vitest run --config $B/bench.config.ts > $B/out/log-A-sem$S.txt 2>&1
  BEREAN_EMBED_DB=$DB BENCH_FILE=holdout.jsonl BENCH_LAYER=A BENCH_MODEL=llama3.1:latest BENCH_TAG=hsem$S npx vitest run --config $B/bench.config.ts > $B/out/log-A-hsem$S.txt 2>&1
done
echo "== layer F (llama3.1) S0 vs best-candidates on topical sections $(date +%T)"
for S in S0 S1 S3; do
  case $S in S0) DB=$G/none.db ;; S1) DB=$G/verse_embeddings.db ;; S3) DB=$G/emb_mxbai.db ;; esac
  BEREAN_EMBED_DB=$DB BENCH_FILE=holdout.jsonl BENCH_LAYER=F BENCH_MODEL=llama3.1:latest BENCH_TAG=hsem$S BENCH_SECTIONS=XP,XS npx vitest run --config $B/bench.config.ts > $B/out/log-F-hsem$S.txt 2>&1
done
echo "SEMDONE $(date +%T)"

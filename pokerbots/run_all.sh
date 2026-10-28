#!/usr/bin/env bash
# Reproduce the whole study. Each step is resumable (finished results are skipped).
#   ./run_all.sh            full study (~15 CPU-hours on 4 cores of a 2.3 GHz Xeon)
#   QUICK=1 ./run_all.sh    smoke run: tiny budgets, 2 pairs per pairing, 200 hands
# Uses WORKERS parallel single-threaded processes (default 3 of 4 cores).
# Note: a step longer than your shell/session allows can simply be re-run; it resumes.
set -euo pipefail
cd "$(dirname "$0")"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PYTHONHASHSEED=0
WORKERS=${WORKERS:-3}
if [[ "${QUICK:-0}" == "1" ]]; then
  PAIRS=2; HANDS=200; FULL_BUDGETS="1"; PRE_BUDGETS="1"; LEAD_PAIRS=4; ROB_PAIRS=2
  export BUDGET_OVERRIDE=1m
  # keep smoke results apart from the study's results
  export POKER_RESULTS="$PWD/results_quick" TABLES_OUT="$PWD/report/tables_quick.md"
else
  PAIRS=10; HANDS=1000; FULL_BUDGETS="15,30,60"; PRE_BUDGETS="5,15,30"; LEAD_PAIRS=60; ROB_PAIRS=6
fi

echo "== 1. unit + conformance tests"
python3 -m unittest discover -s engine/tests -t . -q
python3 -m unittest discover -s bots/tests -t . -q
python3 -m unittest tournament.test_mit_adapter -q

echo "== 2. CFR training (full game: $FULL_BUDGETS min; preflop: $PRE_BUDGETS min; per variant)"
python3 -m experiments.train_cfr --full "$FULL_BUDGETS" --preflop "$PRE_BUDGETS" --workers "$WORKERS"

echo "== 3. CFR strength vs training time"
python3 -m experiments.cfr_budget --variants a_nlhe100,c_discard3 --pairs "$PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 4. round-robin on every variant + dummies"
python3 -m experiments.roundrobin --variants all --pairs "$PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 5. out-of-sample check of the late designs (hybrid) on fresh seeds"
python3 -m experiments.hybrid_eval --pairs "$PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 6. robustness (rules-mapping bugs)"
python3 -m experiments.robustness --pairs "$ROB_PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 7. lead protection"
python3 -m experiments.lead_protection --bots balanced,adaptive --pairs "$LEAD_PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 8. timing (single process; run on an idle machine)"
python3 -m experiments.timing --hands 200

echo "== 9. tables + per-pair CSV"
python3 -m report.make_tables
python3 -m experiments.export_pairs
echo "done: see report/tables.md and REPORT.md"
echo "(the hold-out adaptation drill is manual by design: see report/drill_log.md)"

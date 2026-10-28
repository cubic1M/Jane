#!/usr/bin/env bash
# Reproduce the whole study. Each step is resumable (finished results are skipped).
#   ./run_all.sh            full study (many CPU-hours; see REPORT.md for timings)
#   QUICK=1 ./run_all.sh    smoke run: tiny budgets, 1 pair per pairing, 200 hands
# Uses WORKERS parallel single-threaded processes (default 3 of 4 cores).
set -euo pipefail
cd "$(dirname "$0")"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 PYTHONHASHSEED=0
WORKERS=${WORKERS:-3}
if [[ "${QUICK:-0}" == "1" ]]; then
  PAIRS=1; HANDS=200; FULL_BUDGETS="1"; PRE_BUDGETS="1"; LEAD_PAIRS=4; ROB_PAIRS=1
else
  PAIRS=10; HANDS=1000; FULL_BUDGETS="15,30,60"; PRE_BUDGETS="5,15,30"; LEAD_PAIRS=60; ROB_PAIRS=6
fi

echo "== 1. unit + conformance tests"
python3 -m unittest discover -s engine/tests -t . -q
python3 -m unittest discover -s bots/tests -t . -q

echo "== 2. CFR training (preflop: $PRE_BUDGETS min; full game: $FULL_BUDGETS min; per variant)"
python3 -m experiments.train_cfr --full "$FULL_BUDGETS" --preflop "$PRE_BUDGETS" --workers "$WORKERS"

echo "== 3. CFR strength vs training time"
python3 -m experiments.cfr_budget --full "$FULL_BUDGETS" --preflop "$PRE_BUDGETS" --pairs "$PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 4. round-robin on every variant + dummies"
python3 -m experiments.roundrobin --variants all --pairs "$PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 5. robustness (rules-mapping bugs)"
python3 -m experiments.robustness --pairs "$ROB_PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 6. lead protection"
python3 -m experiments.lead_protection --pairs "$LEAD_PAIRS" --hands "$HANDS" --workers "$WORKERS"

echo "== 7. timing (single process; run on an idle machine)"
python3 -m experiments.timing --hands 200

echo "== 8. tables"
python3 -m report.make_tables
echo "done: see report/tables.md and REPORT.md"

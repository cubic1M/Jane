#!/usr/bin/env bash
# Remaining experiments as one detached, resumable queue (finished pairs are skipped):
# round-robin, CFR budget, robustness, lead protection, then timing (single process,
# on an otherwise idle machine) and tables.
#   setsid nohup ./run_queue.sh > results/logs/queue.log 2>&1 < /dev/null &
cd "$(dirname "$0")"
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
W=${WORKERS:-3}
python3 -m experiments.roundrobin --variants all --pairs 10 --hands 1000 --workers "$W"
python3 -m experiments.cfr_budget --variants a_nlhe100,c_discard3 --pairs 10 --workers "$W"
python3 -m experiments.robustness --pairs 6 --workers "$W"
python3 -m experiments.lead_protection --bots balanced,adaptive --pairs 60 --workers "$W"
python3 -m experiments.timing --hands 200
python3 -m report.make_tables
echo QUEUE DONE

#!/bin/bash
# Timed library-miss demo: dayof + 15-min training on 4 workers, then the checks a
# person would run at the 5- and 15-minute checkpoints.
cd "$(dirname "$0")/../.."
T0=$(date +%s)
t() { echo "[+$(( $(date +%s) - T0 ))s $(date -u +%T)] $*"; }
t "start: dayof --train-full 15 --workers 4"
python3 dayof.py --variant demo_nlhe_scaled --bots balanced,champion@15m_w4 --train-full 15 --workers 4 \
    > results/demo/B_dayof.txt 2>&1
t "dayof done rc=$? ($(grep -E '^(GO|NO-GO)' results/demo/B_dayof.txt | head -1))"
P=cache/cfr/full_demo_nlhe_scaled
while [ ! -f ${P}_5m_w4.pkl ]; do sleep 5; done
t "5-minute checkpoint written"
python3 dayof.py --variant demo_nlhe_scaled --quick --bots champion@5m_w4 > results/demo/B_check5.txt 2>&1
t "5m check: $(grep -E 'champion' results/demo/B_check5.txt | head -1) / $(grep -E '^(GO|NO-GO)' results/demo/B_check5.txt)"
while [ ! -f ${P}_15m_w4.pkl ]; do sleep 5; done
t "15-minute checkpoint written"
python3 dayof.py --variant demo_nlhe_scaled --quick --bots champion@15m_w4,champion@15m_w4+lp > results/demo/B_check15.txt 2>&1
t "15m check: $(grep -E '^(GO|NO-GO)' results/demo/B_check15.txt)"
grep -E "^  champion" results/demo/B_check15.txt
tail -3 dayof_train_full_demo_nlhe_scaled.log
t "strength: freshly trained champion vs balanced, 6 pairs x 1000 hands"
python3 -m experiments.field_eval --exp demo_b --seed0 70000 --candidates champion@15m_w4 \
    --field balanced,opp_tag,opp_exploit --variants demo_nlhe_scaled --pairs 6 --workers 4 \
    > results/demo/B_strength.txt 2>&1
t "done"

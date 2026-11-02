#!/bin/bash
# Exploration: heads-up open / defend switches on heads-up tables (all3 field, seeds 31000+).
cd "$(dirname "$0")/.."
OUT=results/sng_headsup_ab.md
echo "# Heads-up switches, exploration (players=2, all3 field, seeds 31000+, 800 paired tables)" > $OUT
python3 -m sng.arena --players 2 --field all3 --candidates "icm_tag,icm_tag:hu_open_mult=0.9,icm_tag:hu_open_mult=0.8,icm_tag:hu_open_mult=0.7,icm_tag:hu_range_k=3.0,icm_tag:hu_range_k=2.0,icm_tag:hu_open_mult=0.8;hu_range_k=2.5,f3_exploiter" \
  --baseline icm_tag --tables 800 --workers 3 --seed0 31000 2>&1 | grep -A10 "paired" >> $OUT
echo done >> $OUT

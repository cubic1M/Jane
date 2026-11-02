#!/bin/bash
# Exploration 2: wider heads-up opens / defence (players=2, all3, seeds 32000+, 800 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_headsup_ab2.md
echo "# Heads-up switches, exploration 2 (players=2, all3 field, seeds 32000+, 800 paired tables)" > $OUT
python3 -m sng.arena --players 2 --field all3 --candidates "icm_tag:hu_open_mult=0.8;hu_range_k=2.5,icm_tag:hu_open_mult=0.7;hu_range_k=2.0,icm_tag:hu_open_mult=0.6;hu_range_k=2.0,icm_tag:hu_open_mult=0.7;hu_range_k=1.5,icm_tag:hu_open_mult=0.5;hu_range_k=1.5,icm_tag" \
  --baseline "icm_tag:hu_open_mult=0.8;hu_range_k=2.5" --tables 800 --workers 3 --seed0 32000 2>&1 | grep -A8 "paired" >> $OUT
echo done >> $OUT

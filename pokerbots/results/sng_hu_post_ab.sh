#!/bin/bash
# Exploration: which global settings matter heads-up (players=2, all3, seeds 36000+, 800 paired tables)?
cd "$(dirname "$0")/.."
OUT=results/sng_hu_post_ab.md
C="icm_tag,icm_tag:cbet=0.8,icm_tag:value_eq=0.55,icm_tag:bet_discount=0.72,icm_tag:call_margin=0.03,icm_tag:push_bb=12,icm_tag:push_mult=0.85,icm_tag:bluff_bonus=0.8"
{
echo "# Heads-up: global settings, exploration (players=2, all3 field, seeds 36000+, 800 paired tables)"
python3 -m sng.arena --players 2 --field all3 --candidates "$C" --baseline icm_tag --tables 800 --workers 3 --seed0 36000 2>&1 | grep -A9 "paired"
echo done
} > results/logs/sng_hu_post_ab.tmp
mv results/logs/sng_hu_post_ab.tmp $OUT

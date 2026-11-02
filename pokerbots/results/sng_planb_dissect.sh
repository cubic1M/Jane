#!/bin/bash
# Which of our extras costs points in the Plan B field? icm_tag with one feature switched to Plan B's
# behaviour at a time (seeds 64000+, 400 paired tables, rehearsal six-plus preset).
cd "$(dirname "$0")/.."
OUT=results/sng_planb_dissect.md
ALL="read_alpha=0;steal_sym=0;bluff_bonus=0;icm_call=0;hu_open_mult=0;hu_range_k=0;bet_discount=0.6;threebet_rel=99;threebet_eq=0.62;behind_k=0"
C="icm_tag,icm_tag:read_alpha=0,icm_tag:steal_sym=0,icm_tag:bluff_bonus=0,icm_tag:icm_call=0,icm_tag:hu_open_mult=0;hu_range_k=0,icm_tag:bet_discount=0.6,icm_tag:threebet_rel=99;threebet_eq=0.62,icm_tag:$ALL,planb_sd"
{
echo "# Plan B field: one feature at a time (seeds 64000+, 400 paired tables)"
python3 -m sng.arena --preset rehearsal_sixplus --field custom:planb_sd=1 --candidates "$C" --baseline icm_tag --tables 400 --workers 2 --seed0 64000 2>&1 | grep -A14 "paired"
echo done
} > results/logs/sng_planb_dissect.tmp
mv results/logs/sng_planb_dissect.tmp $OUT

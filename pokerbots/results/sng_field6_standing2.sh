#!/bin/bash
# field 6 (postflop specialists, written blind): icm_tag (rs_call=2) vs field bests, rs_call 0 and 3 (seeds 99000+, 400 paired tables)
cd "$(dirname "$0")/.."
OUT=results/sng_field6_standing2.md
C="icm_tag,f3_exploiter,f2_shark,f4_icm,f5_adapt,f5_nash,icm_tag:rs_call=0,icm_tag:rs_call=3"
{
echo "# field 6 (postflop specialists, blind): icm_tag (rs_call=2) vs field bests, rs_call 0 and 3 (seeds 99000+, 400 paired tables)"
echo
python3 -m sng.arena --field field6 --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 99000 2>&1
} > results/logs/sng_field6_standing2.tmp
mv results/logs/sng_field6_standing2.tmp $OUT

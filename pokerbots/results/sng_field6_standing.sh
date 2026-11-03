#!/bin/bash
# field 6 (postflop specialists, written blind): icm_tag vs field bests (seeds 95000+, 400 paired tables)
cd "$(dirname "$0")/.."
OUT=results/sng_field6_standing.md
C="icm_tag,f3_exploiter,f2_shark,f4_icm,f5_adapt,f5_nash,icm_tag:resteal_rel=0;push_steal=0;behind_k=0.8"
{
echo "# field 6 (postflop specialists, blind): icm_tag vs field bests (seeds 95000+, 400 paired tables)"
echo
python3 -m sng.arena --field field6 --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 95000 2>&1
} > results/logs/sng_field6_standing.tmp
mv results/logs/sng_field6_standing.tmp $OUT

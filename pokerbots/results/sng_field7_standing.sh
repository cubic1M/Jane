#!/bin/bash
# field 7 (balanced, bully, trickster, hackathon, profiler; written blind): icm_tag vs field bests (seeds 123000+, 400 paired tables)
cd "$(dirname "$0")/.."
OUT=results/sng_field7_standing.md
C="icm_tag,f3_exploiter,f2_shark,f4_icm,f5_adapt,f5_nash,icm_tag:rs_call=0,f6_checkraiser"
{
echo "# field 7 (written blind): icm_tag vs field bests (seeds 123000+, 400 paired tables)"
echo
python3 -m sng.arena --field field7 --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 123000 2>&1
} > results/logs/sng_field7_standing.tmp
mv results/logs/sng_field7_standing.tmp $OUT

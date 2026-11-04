#!/bin/bash
# field 7 (balanced, bully, trickster, hackathon, profiler; written blind): icm_tag vs field bests (seeds 161000+, 400 paired tables)
cd "$(dirname "$0")/.."
OUT=results/sng_field7_standing2.md
C="icm_tag,f2_shark,f6_checkraiser,f5_nash,icm_tag:rfi_lock=0"
{
echo "# field 7 (written blind): icm_tag vs field bests (seeds 161000+, 400 paired tables)"
echo
python3 -m sng.arena --field field7 --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 161000 2>&1
} > results/logs/sng_field7_standing2.tmp
mv results/logs/sng_field7_standing2.tmp $OUT

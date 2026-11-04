#!/bin/bash
# field 8 (five bots written blind to win the format): standings, no time limit (seeds 181000+, 400 paired tables)
cd "$(dirname "$0")/.."
OUT=results/sng_field8_standing.md
{
echo "# field 8 (written blind to win): icm_tag vs icm_switch and our strongest other bots (seeds 181000+, 400 paired tables, no time limit)"
python3 -m sng.arena --field field8 --no-enforce --candidates "icm_tag,icm_switch,f7_balanced,f2_shark,f3_exploiter" --baseline icm_tag --tables 400 --workers 3 --seed0 181000 2>&1 | grep -E "^\| |paired|^  [a-z0-9_]+ +[-+]"
} > results/logs/sng_field8_standing.tmp
mv results/logs/sng_field8_standing.tmp $OUT

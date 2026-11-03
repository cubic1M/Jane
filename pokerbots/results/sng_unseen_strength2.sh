#!/bin/bash
# Strength (not just legality) on card rules never used for tuning: our any-variant bot vs the best
# bots of every field, on the default field (seeds 119000+, 200 paired tables, time limit off so a
# loaded host cannot fold decisions; timing is covered by the bug hunter).
cd "$(dirname "$0")/.."
OUT=results/sng_unseen_strength2.md
{
echo "# Strength on unseen card rules WITH any-variant tables (seeds 119000+, 200 paired tables, default field, --no-enforce)"
i=0
for v in c_discard3 i_double_discard k_irish n_plo4; do
  i=$((i+1)); echo -e "\n## $v\n"
  python3 -m sng.arena --variant $v --no-enforce --candidates "icm_any,icm_tag,f3_exploiter,f2_shark,f5_adapt,f6_checkraiser" \
    --baseline icm_any --tables 200 --workers 3 --seed0 $((119000+1000*i)) 2>&1 | grep -E "^\| |paired|^  [a-z0-9_]+ +[-+]"
done
echo done
} > results/logs/sng_unseen_strength2.tmp
mv results/logs/sng_unseen_strength2.tmp $OUT

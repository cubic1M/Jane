#!/bin/bash
# Where we stand after resteal_rel: icm_tag vs the field bests on all3 and field 4 (seeds 81000+, 400 tables).
cd "$(dirname "$0")/.."
OUT=results/sng_standing3.md
C="icm_tag,f3_exploiter,f4_icm,f4_mc,f2_shark,icm_lite"
{
echo "# standings after resteal_rel (seeds 81000+, 400 paired tables)"
i=0
for f in all3 field4; do
  i=$((i+1)); echo -e "\n## $f\n"
  python3 -m sng.arena --field $f --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((81000+100*i)) 2>&1 | grep -E "^\| |paired|^  [a-z]"
done
echo done
} > results/logs/sng_standing3.tmp
mv results/logs/sng_standing3.tmp $OUT

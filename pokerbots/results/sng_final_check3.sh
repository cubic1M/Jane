#!/bin/bash
# Regression check 3 (all tonight's adoptions incl. icm_call): the thin cells with more tables.
cd "$(dirname "$0")/.."
OUT=results/sng_final_check3.md
{
echo "# current icm_tag on the thin cells (fresh seeds 43000+, 800 paired tables)"
i=0
for cell in "--field field2|f2_shark,f2_nash" "--field all3 --payouts top3|f3_exploiter,f2_shark" "--field field3|f3_exploiter"; do
  i=$((i+1)); args="${cell%%|*}"; others="${cell#*|}"
  echo -e "\n## $args\n"
  python3 -m sng.arena $args --candidates "icm_tag,$others" --baseline icm_tag --tables 800 --workers 3 \
    --seed0 $((43000+100*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_final_check3.tmp
mv results/logs/sng_final_check3.tmp $OUT

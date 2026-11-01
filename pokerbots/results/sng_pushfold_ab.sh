#!/bin/bash
# ICM push/fold charts vs icm_tag's heuristic short-stack rules, on three fields.
cd "$(dirname "$0")/.."
OUT=results/sng_pushfold_ab.md
echo "# push/fold equilibrium charts A/B (fresh seeds 14000+, 400 paired tables per field)" > $OUT
i=0
for f in field2 default mirror; do
  i=$((i+1))
  echo -e "\n## field=$f\n" >> $OUT
  python3 -m sng.arena --field $f --candidates "icm_tag,icm_tag:pf_chart=1;pf_max_bb=10,icm_tag:pf_chart=1;pf_max_bb=15,icm_tag:pf_chart=1;pf_max_bb=20" \
    --baseline icm_tag --tables 400 --workers 4 --seed0 $((14000+i)) 2>&1 | grep -A5 "paired" >> $OUT
done
echo done >> $OUT

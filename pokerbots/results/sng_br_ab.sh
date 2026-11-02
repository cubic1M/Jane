#!/bin/bash
# Best-response shove charts (from measured call rates) vs icm_tag's own short-stack rules.
cd "$(dirname "$0")/.."
OUT=results/sng_br_ab.md
echo "# best-response shove charts A/B (fresh seeds 17000+, 400 paired tables, 2 workers)" > $OUT
i=0
for f in default field2 field3 mirror; do
  i=$((i+1)); echo -e "\n## field=$f\n" >> $OUT
  OWN="icm_tag:pf_chart=1;pf_file=br_${f}_synthetic;pf_max_bb=10"
  [ -f cache/sng/pushfold_br_${f}_synthetic.json ] || OWN=""
  C="icm_tag,icm_tag:pf_chart=1;pf_file=br_blend_synthetic;pf_max_bb=10,icm_tag:pf_chart=1;pf_file=br_blend_synthetic;pf_max_bb=15"
  [ -n "$OWN" ] && C="$C,$OWN"
  python3 -m sng.arena --field $f --candidates "$C" --baseline icm_tag --tables 400 --workers 2 --seed0 $((17000+i)) 2>&1 \
    | grep -A5 "paired" >> $OUT
done
echo done >> $OUT

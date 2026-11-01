#!/bin/bash
# Fixed settings (field-1 tuned defaults, field-2 tuned) vs table-adaptive rules, on both fields.
cd "$(dirname "$0")/.."
OUT=results/sng_adaptive.md
F2="icm_tag:open_mult=1.177;bet_frac=0.5;call_margin=0.03;range_k=3.2;push_mult=1.1"
C="icm_tag,$F2,icm_tag:steal_sym=0.5,icm_tag:read_alpha=0.5,icm_tag:steal_sym=0.5;read_alpha=0.5"
echo "# fixed vs table-adaptive (fresh seeds 12000+, 400 paired tables per field)" > $OUT
i=0
for f in field2 default mirror; do
  i=$((i+1))
  echo -e "\n## field=$f\n" >> $OUT
  python3 -m sng.arena --field $f --candidates "$C" --baseline icm_tag --tables 400 --workers 4 --seed0 $((12000+i)) 2>&1 \
    | grep -A6 "paired" >> $OUT
done
echo done >> $OUT

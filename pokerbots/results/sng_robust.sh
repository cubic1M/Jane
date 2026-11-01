#!/bin/bash
# Robustness grid: fields x point tables, fresh seeds, tuned icm_tag vs the field's best bots.
cd "$(dirname "$0")/.."
OUT=results/sng_robust.md
echo "# icm_tag robustness (fresh seeds 7000+, 300 paired tables per cell)" > $OUT
i=0
for field in default strong weak; do
  for pay in synthetic top3 winner linear; do
    i=$((i+1))
    echo -e "\n## field=$field payouts=$pay\n" >> $OUT
    python3 -m sng.arena --candidates icm_tag,pushfold_icm,adaptive,chen_tag --baseline icm_tag \
      --field $field --payouts $pay --tables 300 --workers 4 --seed0 $((7000+i)) 2>&1 \
      | grep -v "tables (" | sed -n '1,12p' >> $OUT
  done
done
echo done >> $OUT

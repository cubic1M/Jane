#!/bin/bash
# Robustness 2: card variants and blind schedules (default field, synthetic points).
cd "$(dirname "$0")/.."
OUT=results/sng_robust2.md
echo "# icm_tag robustness 2: variants and blind schedules (fresh seeds 7100+, 300 paired tables per cell)" > $OUT
i=0
for cell in "--variant e_shortdeck" "--variant d_omaha4x2" "--betting pot_limit" "--blinds fast" "--blinds slow"; do
  i=$((i+1))
  echo -e "\n## $cell\n" >> $OUT
  python3 -m sng.arena --candidates icm_tag,pushfold_icm,adaptive,chen_tag --baseline icm_tag \
    $cell --tables 300 --workers 4 --seed0 $((7100+i)) 2>&1 | grep -v "tables (" | sed -n '1,12p' >> $OUT
done
echo done >> $OUT

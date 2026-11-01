#!/bin/bash
# Validate a tuned icm_tag against the defaults on fresh seeds, every field (+ top3 payouts, rehearsal rules).
# usage: results/sng_validate.sh "icm_tag:<params>"
cd "$(dirname "$0")/.."
T="$1"
OUT=results/sng_validate.md
echo "# validate: $T vs icm_tag defaults (fresh seeds 9500+, 400 paired tables per cell)" > $OUT
i=0
for cell in "--field default" "--field strong" "--field weak" "--field mirror" "--field default --payouts top3" "--field default --preset rehearsal_sixplus"; do
  i=$((i+1))
  echo -e "\n## $cell\n" >> $OUT
  python3 -m sng.arena --candidates "icm_tag,$T" --baseline icm_tag $cell --tables 400 --workers 4 --seed0 $((9500+i)) 2>&1 \
    | grep -A2 "paired" >> $OUT
done
echo done >> $OUT

#!/bin/bash
# Postflop raise rule (raise_eq) A/B on three fields.
cd "$(dirname "$0")/.."
OUT=results/sng_raise_ab.md
echo "# postflop raise rule A/B (fresh seeds 18000+, 400 paired tables, 2 workers)" > $OUT
i=0
for f in default field2 field3; do
  i=$((i+1)); echo -e "\n## field=$f\n" >> $OUT
  python3 -m sng.arena --field $f --candidates "icm_tag,icm_tag:raise_eq=0.75,icm_tag:raise_eq=0.85,icm_tag:raise_eq=0.92" \
    --baseline icm_tag --tables 400 --workers 2 --seed0 $((18000+i)) 2>&1 | grep -A5 "paired" >> $OUT
done
echo done >> $OUT

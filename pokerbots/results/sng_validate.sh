#!/bin/bash
# Validate a tuned icm_tag against the defaults on fresh seeds, every field (+ top3 payouts, rehearsal rules).
# usage: results/sng_validate.sh "icm_tag:<params>" [extra arena args, e.g. --preset day]
# With extra args (the day's rules) every cell uses them; the rehearsal cell is then skipped.
cd "$(dirname "$0")/.."
T="$1"; shift; EXTRA="$*"
OUT=results/sng_validate.md
echo "# validate: $T vs icm_tag defaults (fresh seeds 9500+, 400 paired tables per cell)" > $OUT
i=0
CELLS=("--field default" "--field strong" "--field weak" "--field mirror" "--field default --payouts top3" "--field default --preset rehearsal_sixplus")
[ -n "$EXTRA" ] && CELLS=("--field default" "--field strong" "--field weak" "--field mirror" "--field blend")
for cell in "${CELLS[@]}"; do
  i=$((i+1))
  echo -e "\n## $cell\n" >> $OUT
  python3 -m sng.arena --candidates "icm_tag,$T" --baseline icm_tag $cell $EXTRA --tables 400 --workers 4 --seed0 $((9500+i)) 2>&1 \
    | grep -A2 "paired" >> $OUT
done
echo done >> $OUT

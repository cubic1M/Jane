#!/bin/bash
# Discard / draw variants: icm_any vs icm_tag (hold'em tables + engine-fallback discards) vs field bests.
# Field bots get the shared discard policy (sng.arena DiscardHelper), so this measures betting.
cd "$(dirname "$0")/.."
OUT=results/sng_discards.md
echo "# discard/draw variants (300 paired tables each, default field, fresh seeds 13000+)" > $OUT
i=0
for p in discard_to_board omaha_discard2 draw_holdem five_draw; do
  i=$((i+1))
  echo -e "\n## $p\n" >> $OUT
  python3 -m sng.arena --preset $p --candidates icm_any,icm_tag,pushfold_icm,chen_tag --baseline icm_any \
    --tables 300 --workers 4 --seed0 $((13000+i)) 2>&1 | grep -v "tables (" | sed -n '1,13p' >> $OUT
done
echo done >> $OUT

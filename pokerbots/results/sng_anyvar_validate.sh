#!/bin/bash
# Validate the five-draw-tuned icm_any params on all four discard/draw presets (fresh seeds).
cd "$(dirname "$0")/.."
T="icm_any:call_margin=0.03;push_bb=6.0;range_k=3.2;reshove_bb=18.0;steal_bonus=0.7"
OUT=results/sng_anyvar_validate.md
echo "# icm_any tuned (five-draw) vs defaults on every discard/draw preset (fresh seeds 19000+, 300 paired tables)" > $OUT
i=0
for p in five_draw draw_holdem discard_to_board omaha_discard2; do
  i=$((i+1)); echo -e "\n## $p\n" >> $OUT
  python3 -m sng.arena --preset $p --candidates "icm_any,$T" --baseline icm_any --tables 300 --workers 2 \
    --seed0 $((19000+i)) 2>&1 | grep -A2 "paired" >> $OUT
done
echo done >> $OUT

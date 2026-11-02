#!/bin/bash
# behind_k on icm_any (discard/draw presets), seeds 63000+, 600 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_anyvar_behindk.md
C="icm_any,icm_any:behind_k=0.2,icm_any:behind_k=0"
{
echo "# icm_any: behind_k on discard/draw presets (seeds 63000+, 600 paired tables; baseline = old rule 0.8)"
i=0
for p in five_draw draw_holdem discard_to_board omaha_discard2; do
  i=$((i+1)); echo -e "\n## $p\n"
  python3 -m sng.arena --preset $p --candidates "$C" --baseline icm_any --tables 600 --workers 3 \
    --seed0 $((63000+100*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_anyvar_behindk.tmp
mv results/logs/sng_anyvar_behindk.tmp $OUT

#!/bin/bash
# push_steal on icm_any (discard/draw presets), seeds 69000+, 600 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_anyvar_pushsteal.md
C="icm_any,icm_any:push_steal=0.5"
{
echo "# icm_any: push_steal on discard/draw presets (seeds 69000+, 600 paired tables; baseline = push_steal 0)"
i=0
for p in five_draw draw_holdem discard_to_board omaha_discard2; do
  i=$((i+1)); echo -e "\n## $p\n"
  python3 -m sng.arena --preset $p --candidates "$C" --baseline icm_any --tables 600 --workers 3 \
    --seed0 $((69000+100*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_anyvar_pushsteal.tmp
mv results/logs/sng_anyvar_pushsteal.tmp $OUT

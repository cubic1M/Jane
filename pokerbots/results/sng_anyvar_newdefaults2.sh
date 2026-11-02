#!/bin/bash
# Per-switch breakdown on the discard/draw presets (seeds 41000+, 600 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_anyvar_newdefaults2.md
C="icm_any,icm_any:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0,icm_any:hu_open_mult=0;hu_range_k=0,icm_any:icm_call=0"
{
echo "# icm_any: per-switch breakdown on discard/draw presets (seeds 41000+, 600 paired tables)"
i=0
for p in five_draw draw_holdem discard_to_board omaha_discard2; do
  i=$((i+1)); echo -e "\n## $p\n"
  python3 -m sng.arena --preset $p --candidates "$C" --baseline icm_any --tables 600 --workers 3 \
    --seed0 $((41000+100*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_anyvar_newdefaults2.tmp
mv results/logs/sng_anyvar_newdefaults2.tmp $OUT

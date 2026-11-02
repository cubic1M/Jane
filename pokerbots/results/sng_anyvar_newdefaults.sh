#!/bin/bash
# Do tonight's defaults (heads-up ranges, risk_payout, icm_call) also help icm_any on the
# discard/draw presets? Current icm_any vs icm_any with all three switched off (seeds 40000+).
cd "$(dirname "$0")/.."
OUT=results/sng_anyvar_newdefaults.md
OLD="icm_any:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0"
{
echo "# icm_any: tonight's defaults vs switched off, discard/draw presets (seeds 40000+, 400 paired tables)"
i=0
for p in five_draw draw_holdem discard_to_board omaha_discard2; do
  i=$((i+1)); echo -e "\n## $p\n"
  python3 -m sng.arena --preset $p --candidates "icm_any,$OLD" --baseline icm_any --tables 400 --workers 3 \
    --seed0 $((40000+100*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_anyvar_newdefaults.tmp
mv results/logs/sng_anyvar_newdefaults.tmp $OUT

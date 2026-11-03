#!/bin/bash
# rs_call=2 (now the default) on other games: icm_any on the discard/draw presets, icm_tag on Omaha 4 / PLO5.
# Baseline = rs_call 0 (seeds 98000+, 400 paired tables). Usage: sng_anyvar_rscall.sh 1|2
cd "$(dirname "$0")/.."
OUT=results/sng_anyvar_rscall_$1.md
{
echo "# rs_call=2 on other games, part $1 (seeds 98000+, 400 paired tables; baseline = rs_call 0)"
if [ "$1" = 1 ]; then
  i=0
  for p in five_draw draw_holdem discard_to_board omaha_discard2; do
    i=$((i+1)); echo -e "\n## preset $p\n"
    python3 -m sng.arena --preset $p --candidates "icm_any:rs_call=0,icm_any" --baseline icm_any:rs_call=0 --tables 400 --workers 3 \
      --seed0 $((98000+100*i)) 2>&1 | grep -A3 "paired"
  done
else
  i=4
  for v in d_omaha4x2 h_plo5 e_shortdeck; do
    i=$((i+1)); echo -e "\n## variant $v\n"
    python3 -m sng.arena --variant $v --candidates "icm_tag:rs_call=0,icm_tag" --baseline icm_tag:rs_call=0 --tables 400 --workers 3 \
      --seed0 $((98000+100*i)) 2>&1 | grep -A3 "paired"
  done
fi
echo done
} > results/logs/sng_anyvar_rscall_$1.tmp
mv results/logs/sng_anyvar_rscall_$1.tmp $OUT

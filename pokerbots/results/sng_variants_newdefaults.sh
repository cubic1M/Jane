#!/bin/bash
# Do tonight's icm_tag defaults hold on non-hold'em card rules (Omaha 4, PLO5, short deck)?
# Current icm_tag vs heads-up ranges off, vs icm_call off (seeds 42000+, 600 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_variants_newdefaults.md
C="icm_tag,icm_tag:hu_open_mult=0;hu_range_k=0,icm_tag:icm_call=0"
{
echo "# icm_tag defaults on other card rules (seeds 42000+, 600 paired tables, default field)"
i=0
for v in d_omaha4x2 h_plo5 e_shortdeck; do
  i=$((i+1)); echo -e "\n## $v\n"
  python3 -m sng.arena --variant $v --candidates "$C" --baseline icm_tag --tables 600 --workers 3 \
    --seed0 $((42000+100*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_variants_newdefaults.tmp
mv results/logs/sng_variants_newdefaults.tmp $OUT

#!/bin/bash
# How much does a restrictive kit cost? The flat bundle carries icm_any (no strength tables), not icm_tag.
# Kit-4 rules (six-plus, no antes, 100/65/45/...): icm_any vs icm_tag (+ icm_any with icm_tag's
# hold'em switches on) on 4 fields (seeds 117000+, 300 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_planA_gap.md
C="icm_any,icm_tag,icm_any:icm_call=1;rs_call=2;hu_open_mult=0.6;hu_range_k=2.0;bet_discount=0.5"
{
echo "# Plan A gap on kit-4 rules: icm_any vs icm_tag (seeds 117000+, 300 paired tables)"
i=0
for f in default field4 field5 all3; do
  i=$((i+1)); echo -e "\n## $f\n"
  python3 -m sng.arena --preset kit4_sixplus --field $f --candidates "$C" --baseline icm_any --tables 300 --workers 3 \
    --seed0 $((117000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_planA_gap.tmp
mv results/logs/sng_planA_gap.tmp $OUT

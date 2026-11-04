#!/bin/bash
# icm_switch handing over to a field-9 bot (f9_meta: best 14-cell mean, +14..+21 at strong tables, -6..-20 at weak ones).
# Exploration, 300 paired tables x 12 cells, seeds 281000+.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
C="icm_tag,icm_switch,icm_switch:b=f9_meta,icm_switch:b=f9_meta;switch_share=0.25;any_deck=1,icm_switch:b=f9_meta;switch_share=0.22;switch_min=15;any_deck=1,f9_meta"
OUT=results/sng_switch9_ab.md
{
echo "# icm_switch -> f9_meta exploration, seeds 281000+ (300 paired tables)"
i=0
for cell in "--field default" "--field field3" "--field field4" "--field field5" "--field field6" "--field field7" \
            "--field field9" "--field $MIX" "--field all3 --payouts winner" "--field $H" \
            "--preset kit4_sixplus --field field5" "--preset kit4_sixplus --field field9"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((281000+1000*i)) 2>&1 | grep -A6 "paired"
done
echo done
} > results/logs/sng_switch9_ab.tmp
mv results/logs/sng_switch9_ab.tmp $OUT

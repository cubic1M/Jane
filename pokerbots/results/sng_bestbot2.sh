#!/bin/bash
# Which bot to submit, round 2: icm_tag vs the newest blind-written bots (field 8 / 9) and the earlier best ones,
# 14 cells (every field + payouts + kit-4 rules), 300 paired tables, time limit ON, fresh seeds 271000+.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
C="icm_tag,f8_ensemble,f8_adaptive,f9_bubble,f9_meta,f9_threebet,f7_balanced,f3_exploiter"
OUT=results/sng_bestbot2.md
{
echo "# Which bot, round 2 (300 paired tables, time limit on, seeds 271000+)"
i=0
for cell in "--field default" "--field field2" "--field field3" "--field field4" "--field field5" "--field field6" \
            "--field field7" "--field field8" "--field field9" "--field all3 --payouts winner" "--field $H" "--field $MIX" \
            "--preset kit4_sixplus --field field5" "--preset kit4_sixplus --field field9"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((271000+1000*i)) 2>&1 | grep -E "^\| [a-z]|paired|^  [a-z]"
done
echo done
} > results/logs/sng_bestbot2.tmp
mv results/logs/sng_bestbot2.tmp $OUT

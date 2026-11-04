#!/bin/bash
# Final configuration check (Nov 4 night): icm_switch (52-card + six-plus hand-over to f9_meta) vs icm_tag,
# 12 cells, 600 paired tables, fresh seeds 361000+, time limit on.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
REAL="custom:f10_chen=1,f10_montecarlo=1,f10_pushfold=1,f10_llm_rules=1,f10_aggro=1,f10_passive=1,f10_tag_simple=1,f10_exploit_lite=1,f9_meta=1,f9_threebet=1,f8_ensemble=1,f7_balanced=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch"
OUT=results/sng_final_switch_check.md
{
echo "# final icm_switch vs icm_tag, fresh seeds 361000+ (600 paired tables, time limit on)"
i=0
for cell in "--field default" "--field field3" "--field field5" "--field field10" "--field $REAL" "--field all3 --payouts winner" \
            "--field $H" "--field field7" "--field $CH" "--preset kit4_sixplus --field field10" \
            "--preset kit4_sixplus --field $REAL" "--preset kit4_sixplus --field field5"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((361000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_final_switch_check.tmp
mv results/logs/sng_final_switch_check.tmp $OUT

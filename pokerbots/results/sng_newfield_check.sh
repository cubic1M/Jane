#!/bin/bash
# icm_switch (default) and the strong-room resubmit vs icm_tag on settings not yet tried with icm_switch:
# 6 / 9 players, top2 / linear / winner payouts, slow blinds. Fresh seeds 601000+, 400 paired tables per cell,
# baseline icm_tag, time limit on. Resumable.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_newfield_check.md
TMP=results/logs/sng_newfield_check.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# icm_switch + strong-room option vs icm_tag on new settings, seeds 601000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field $ROOM --players 6" "--field $ROOM --players 9" "--field $H --players 6" "--field field7 --players 9" \
            "--field $ROOM --payouts top2" "--field $ROOM --payouts linear" "--field $ROOM --blinds slow" "--field $CH --payouts winner"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:22} ...${cell: -16}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((601000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

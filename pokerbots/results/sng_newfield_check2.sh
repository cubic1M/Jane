#!/bin/bash
# icm_switch (default) and the strong-room resubmit vs icm_tag, part 2 of the settings not yet tried with icm_switch:
# heads-up / 3 / 4 players, bounties, pot-limit hold'em, fast blinds. Fresh seeds 611000+, 400 paired tables per cell,
# baseline icm_tag, time limit on. Resumable.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_newfield_check2.md
TMP=results/logs/sng_newfield_check2.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# icm_switch + strong-room option vs icm_tag on new settings part 2, seeds 611000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field $ROOM --players 2" "--field $ROOM --players 3" "--field field7 --players 4" "--field $ROOM --preset bounty10" \
            "--field $CH --preset bounty10" "--field $ROOM --betting pot_limit" "--field $ROOM --blinds fast"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:22} ...${cell: -16}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((611000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

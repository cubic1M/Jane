#!/bin/bash
# icm_switch hand-back (undo a noise hand-over): after the hand-over, < back_share of the next N opens re-raised ->
# icm_tag again. Exploration, 400 paired tables x 9 cells, seeds 451000+, baseline icm_switch. Resumable.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_switch,icm_switch:hand_back=15;back_share=0.18,icm_switch:hand_back=15;back_share=0.22,icm_switch:hand_back=10;back_share=0.2"
OUT=results/sng_handback_ab.md
TMP=results/logs/sng_handback_ab.tmp
DONE=$(grep -c "hand_back=10;back_share=0.2 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# hand-back exploration, seeds 451000+ (400 paired tables, baseline icm_switch)" > $TMP
{
i=0
for cell in "--field field5" "--field field3" "--field default" "--field field10" "--field $ROOM" "--field field7" "--field $CH" "--field $MIX" "--field field6"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:30}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 400 --workers 3 --seed0 $((451000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

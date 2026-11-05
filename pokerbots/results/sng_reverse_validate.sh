#!/bin/bash
# Reverse switch (strong-room option) fresh-seed confirmation vs icm_switch and icm_tag: strong / room / kit-4 cells.
# 600 paired tables, seeds 421000+. Resumable after restarts.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_reverse_validate.md
TMP=results/logs/sng_reverse_validate.tmp
DONE=$(grep -c "^  icm_switch:start" $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# reverse switch confirmation, fresh seeds 421000+ (600 paired tables, baseline icm_tag)" > $TMP
{
i=0
for cell in "--field field7" "--field $CH" "--field $MIX" "--field field6" "--field $ROOM" "--preset kit4_sixplus --field $ROOM"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((421000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

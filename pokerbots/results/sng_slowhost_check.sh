#!/bin/bash
# Slower host (~1.4x, Nov 5): icm_switch vs icm_tag with the 1 ms limit ON - do over-limit decisions cost points?
# 600 paired tables, fresh seeds 441000+. Resumable.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
C="icm_tag,icm_switch"
OUT=results/sng_slowhost_check.md
TMP=results/logs/sng_slowhost_check.tmp
DONE=$(grep -c "^| icm_switch" $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# slower host, time limit on: icm_switch vs icm_tag, fresh seeds 441000+ (600 paired tables)" > $TMP
{
i=0
for cell in "--field $ROOM" "--field field10" "--field field5" "--field field7" "--preset kit4_sixplus --field $ROOM"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:30} ${cell: -12}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((441000+1000*i)) 2>&1 | grep -E "^\| icm|paired|^  icm"
done
echo done
} >> $TMP
mv $TMP $OUT

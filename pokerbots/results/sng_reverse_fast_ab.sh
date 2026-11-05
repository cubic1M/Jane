#!/bin/bash
# Reverse switch made decision-only safe: no f9 ICM while > N players alive (+ cache). Strength vs the exact reverse
# switch. 400 paired tables x 7 cells, seeds 431000+. Resumable.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
R="icm_switch:start=b;back_share=0.22;switch_min=15"
C="$R,$R;f9_min_left=5;f9_cache=0.1,$R;f9_min_left=6"
OUT=results/sng_reverse_fast_ab.md
TMP=results/logs/sng_reverse_fast_ab.tmp
DONE=$(grep -c "f9_min_left=6 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# fast reverse switch vs exact, seeds 431000+ (400 paired tables, baseline the exact reverse switch)" > $TMP
{
i=0
for cell in "--field field7" "--field $CH" "--field $MIX" "--field field6" "--field $ROOM" "--field field5" "--preset kit4_sixplus --field $ROOM"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline "$R" --tables 400 --workers 3 --seed0 $((431000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

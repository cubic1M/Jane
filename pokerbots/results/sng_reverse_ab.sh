#!/bin/bash
# Reverse switch: f9_meta from hand 1, back to icm_tag (one-way) when < back_share of 20+ opens get re-raised.
# Exploration, 300 paired tables x 10 cells, seeds 401000+, baseline icm_tag. Resumable after restarts.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.18,icm_switch:start=b;back_share=0.22,icm_switch:start=b;back_share=0.22;switch_min=15,f9_meta"
OUT=results/sng_reverse_ab.md
TMP=results/logs/sng_reverse_ab.tmp
DONE=$(grep -c "^  f9_meta" $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# reverse switch exploration, seeds 401000+ (300 paired tables, baseline icm_tag)" > $TMP
{
i=0
for cell in "--field field5" "--field field3" "--field default" "--field field10" "--field $ROOM" "--field $ROOM --payouts top3" \
            "--preset kit4_sixplus --field $ROOM" "--field field7" "--field $CH" "--field $MIX"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:40} ${cell: -16}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((401000+1000*i)) 2>&1 | grep -A6 "paired" | grep -v "^--"
done
echo done
} >> $TMP
mv $TMP $OUT

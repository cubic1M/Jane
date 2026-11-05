#!/bin/bash
# Best guess at a regional room: 50% team-style bots (field 10), 25% our earlier hand-built fields (1-5),
# 25% strong blind-written bots (fields 7-9). icm_switch vs icm_tag (+ f9_meta for reference), 800 paired
# tables, fresh seeds 391000+, time limit on; synthetic and top-3 payouts, kit-4 rules.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
C="icm_tag,icm_switch,f9_meta"
OUT=results/sng_regional_room.md
{
echo "# regional-room guess, fresh seeds 391000+ (800 paired tables; baseline icm_tag)"
i=0
for cell in "--field $ROOM" "--field $ROOM --payouts top3" "--preset kit4_sixplus --field $ROOM"; do
  i=$((i+1)); echo -e "\n## ${cell:0:6} ${cell: -25}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 800 --workers 3 --seed0 $((391000+1000*i)) 2>&1 | grep -E "^\| (icm|f9_meta)|paired|^  (icm|f9)"
done
echo done
} > results/logs/sng_regional_room.tmp
mv results/logs/sng_regional_room.tmp $OUT

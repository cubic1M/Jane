#!/bin/bash
# Field 10 (hackathon-realistic team bots, blind): standing + does icm_switch's hand-over misfire there?
# 400 paired tables, fresh seeds 341000+, time limit on.
cd "$(dirname "$0")/.."
C="icm_tag,icm_switch,f9_meta,f7_balanced,f8_ensemble"
REAL="custom:f10_chen=1,f10_montecarlo=1,f10_pushfold=1,f10_llm_rules=1,f10_aggro=1,f10_passive=1,f10_tag_simple=1,f10_exploit_lite=1,f9_meta=1,f9_threebet=1,f8_ensemble=1,f7_balanced=1"
OUT=results/sng_field10_standing.md
{
echo "# Field 10 standing, fresh seeds 341000+ (400 paired tables; baseline icm_tag)"
i=0
for cell in "--field field10" "--field field10 --payouts top3" "--preset kit4_sixplus --field field10" "--field $REAL" "--preset kit4_sixplus --field $REAL"; do
  i=$((i+1)); echo -e "\n## ${cell:0:70}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((341000+1000*i)) 2>&1 | grep -E "^\| [a-z]|paired|^  [a-z]" | head -24
done
echo done
} > results/logs/sng_field10_standing.tmp
mv results/logs/sng_field10_standing.tmp $OUT

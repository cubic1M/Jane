#!/bin/bash
# 52-card hand-over target: f7_balanced (current) vs f9_meta, head to head incl. field 10 (where the f7 hand-over
# misfires: -1.9*). 600 paired tables, fresh seeds 351000+, baseline icm_switch.
cd "$(dirname "$0")/.."
REAL="custom:f10_chen=1,f10_montecarlo=1,f10_pushfold=1,f10_llm_rules=1,f10_aggro=1,f10_passive=1,f10_tag_simple=1,f10_exploit_lite=1,f9_meta=1,f9_threebet=1,f8_ensemble=1,f7_balanced=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
C="icm_switch,icm_switch:b=f9_meta,icm_tag"
OUT=results/sng_b52_h2h.md
{
echo "# 52-card hand-over target f7 vs f9_meta, fresh seeds 351000+ (600 paired tables; baseline icm_switch)"
i=0
for cell in "--field field10" "--field field10 --payouts top3" "--field $REAL" "--field field5" "--field field3" \
            "--field default" "--field field7" "--field $MIX"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 600 --workers 3 --seed0 $((351000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_b52_h2h.tmp
mv results/logs/sng_b52_h2h.tmp $OUT

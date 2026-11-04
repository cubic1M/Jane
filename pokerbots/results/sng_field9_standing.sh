#!/bin/bash
# Field 9 (blind: threebet, limptrap, bubble, float, gto, meta): where do we stand? Fresh seeds 241000+, 400 paired tables.
cd "$(dirname "$0")/.."
C="icm_tag,f2_shark,f3_exploiter,f7_balanced,f8_ensemble,icm_switch"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
OUT=results/sng_field9_standing.md
{
echo "# Field 9 standing, fresh seeds 241000+ (400 paired tables; each candidate takes one seat)"
i=0
for cell in "--field field9" "--field field9 --payouts top3" "--preset kit4_sixplus --field field9" "--field $MIX"; do
  i=$((i+1)); echo -e "\n## ${cell:0:70}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((241000+1000*i)) 2>&1 | grep -v '^$' | head -30
done
echo done
} > results/logs/sng_field9_standing.tmp
mv results/logs/sng_field9_standing.tmp $OUT

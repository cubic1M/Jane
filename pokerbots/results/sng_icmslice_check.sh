#!/bin/bash
# icm_switch with icm_slice=1 (f7's bubble factors refreshed one opponent per hand after the hand-over) vs full refresh,
# on the strong fields where the hand-over happens. 400 paired tables, seeds 301000+.
cd "$(dirname "$0")/.."
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_switch,icm_switch:icm_slice=1,icm_tag"
OUT=results/sng_icmslice_check.md
{
echo "# icm_slice=1 vs full refresh (icm_switch), seeds 301000+ (400 paired tables)"
i=0
for cell in "--field field6" "--field field7" "--field field9" "--field $MIX" "--field $CH" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 400 --workers 3 --seed0 $((301000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_icmslice_check.tmp
mv results/logs/sng_icmslice_check.tmp $OUT

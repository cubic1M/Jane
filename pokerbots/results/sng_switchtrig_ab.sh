#!/bin/bash
# icm_switch hand-over trigger: earlier (rfi_lock_min 12 / 15) or looser (rfi_lock 0.27) vs the default (20, 0.30).
# Exploration, 300 paired tables x 10 cells, seeds 311000+.
cd "$(dirname "$0")/.."
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_switch,icm_switch:rfi_lock_min=15,icm_switch:rfi_lock_min=12,icm_switch:rfi_lock=0.27,icm_switch:rfi_lock_min=15;rfi_lock=0.27"
OUT=results/sng_switchtrig_ab.md
{
echo "# icm_switch trigger exploration, seeds 311000+ (300 paired tables, baseline icm_switch)"
i=0
for cell in "--field default" "--field field3" "--field field5" "--field all3 --payouts winner" "--field field6" \
            "--field field7" "--field field9" "--field $MIX" "--field $CH" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 300 --workers 3 --seed0 $((311000+1000*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_switchtrig_ab.tmp
mv results/logs/sng_switchtrig_ab.tmp $OUT

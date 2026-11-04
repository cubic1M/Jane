#!/bin/bash
# Earlier / tighter rfi_lock vs strong blind fields (field 9 + strongest-bots mix). Exploration, 300 paired tables, seeds 251000+.
cd "$(dirname "$0")/.."
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_tag:rfi_lock_min=10,icm_tag:rfi_lock=0.25,icm_tag:rfi_lock_min=10;rfi_lock=0.25,icm_tag:rfi_scale=1.0,icm_tag:rfi_lock_min=12;rfi_scale=1.1"
OUT=results/sng_lock9_ab.md
{
echo "# earlier/tighter rfi_lock exploration, seeds 251000+ (300 paired tables)"
i=0
for cell in "--field $MIX" "--field field9" "--field $CH" "--field field7" "--field field5" "--field field3" \
            "--field default" "--field all3 --payouts winner" "--field mirror" "--field field6"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((251000+1000*i)) 2>&1 | grep -A6 "paired"
done
echo done
} > results/logs/sng_lock9_ab.tmp
mv results/logs/sng_lock9_ab.tmp $OUT

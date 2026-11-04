#!/bin/bash
# icm_switch:b=f9_meta (lock-triggered hand-over to f9_meta) fresh-seed validation vs icm_tag and icm_switch (f7).
# 600 paired tables, seeds 291000+. Usage: results/sng_switch9_validate.sh <part 1|2>
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch,icm_switch:b=f9_meta"
if [ "$1" = 1 ]; then CELLS=("--field default" "--field field2" "--field field3" "--field field4" "--field field5" "--field all3 --payouts winner" "--field $H"); OFF=0
else CELLS=("--field field6" "--field field7" "--field field8" "--field field9" "--field $MIX" "--field $CH" "--field mirror"); OFF=7; fi
OUT=results/sng_switch9_validate_$1.md
{
echo "# icm_switch:b=f9_meta validation part $1, fresh seeds 291000+ (600 paired tables)"
i=$OFF
for cell in "${CELLS[@]}"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((291000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_switch9_validate_$1.tmp
mv results/logs/sng_switch9_validate_$1.tmp $OUT

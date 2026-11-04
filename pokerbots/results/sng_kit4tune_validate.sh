#!/bin/bash
# Day-of procedure rehearsal: validate the tuner's kit-4 six-plus picks on fresh seeds (187000+... ->
# seeds 191000+, 500 paired tables) under kit-4 rules, on 6 fields incl. the champions table.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_tag:steal_max_behind=3,icm_tag:bet_frac=0.8;raiser_discount=1.05;steal_bonus=0.4;steal_max_behind=3"
OUT=results/sng_kit4tune_validate.md
{
echo "# kit-4 six-plus tuner picks, fresh seeds 191000+ (500 paired tables, kit-4 rules)"
i=0
for f in field4 field5 all3 "$H" "$CH" field7; do
  i=$((i+1)); echo -e "\n## ${f:0:40}\n"
  python3 -m sng.arena --preset kit4_sixplus --field "$f" --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((191000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_kit4tune_validate.tmp
mv results/logs/sng_kit4tune_validate.tmp $OUT

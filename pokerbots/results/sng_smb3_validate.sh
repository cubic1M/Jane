#!/bin/bash
# steal_max_behind=3 (kit-4 tuner pick, +4.4 mean over 6 kit-4 cells on fresh seeds): fresh-seed check on
# standard NLHE, 12 fields, 600 paired tables, seeds 197000+.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_tag:steal_max_behind=3,icm_tag:steal_max_behind=4"
OUT=results/sng_smb3_validate.md
{
echo "# steal_max_behind 3/4 vs 5, NLHE, fresh seeds 197000+ (600 paired tables)"
i=0
for f in default mirror field2 field3 field4 field5 field6 field7 field8 all3 "$H" "$CH"; do
  i=$((i+1)); echo -e "\n## ${f:0:40}\n"
  python3 -m sng.arena --field "$f" --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((197000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_smb3_validate.tmp
mv results/logs/sng_smb3_validate.tmp $OUT

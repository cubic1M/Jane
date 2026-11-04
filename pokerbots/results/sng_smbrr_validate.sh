#!/bin/bash
# smb_rr fresh-seed validation: 600 paired tables x 13 cells, seeds 231000+.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_tag:smb_rr=0.25,icm_tag:smb_rr=0.3"
OUT=results/sng_smbrr_validate.md
{
echo "# smb_rr validation, fresh seeds 231000+ (600 paired tables)"
i=0
for cell in "--field default" "--field field3" "--field field4" "--field field5" "--field field6" "--field field7" \
            "--field field8" "--field mirror" "--field all3 --payouts winner" "--field $H" "--field $CH" \
            "--preset kit4_sixplus --field field5" "--preset rehearsal_sixplus --field custom:planb_sd=7"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((231000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_smbrr_validate.tmp
mv results/logs/sng_smbrr_validate.tmp $OUT

#!/bin/bash
# Fresh-seed validation of resteal / pev with the corrected mapping (seeds 49000+, 600 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_resteal_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:resteal=1;resteal_risk=0.5,icm_tag:pev=1;pev_risk=0.5,icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5"
{
echo "# resteal / pev fresh-seed validation (seeds 49000+, 600 paired tables)"
i=0
for cell in "--field field2" "--field field3" "--field default" "--field mirror" "--field all3 --payouts top3" "--field $H"; do
  i=$((i+1)); echo -e "\n## ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((49000+100*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_resteal_validate.tmp
mv results/logs/sng_resteal_validate.tmp $OUT

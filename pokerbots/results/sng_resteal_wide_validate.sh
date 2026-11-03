#!/bin/bash
# Fresh-seed validation of wider re-shoves (rel 1.4, depth 35bb) vs the adopted rel 1.0 + read (seeds 87000+, 600 paired tables per cell).
cd "$(dirname "$0")/.."
OUT=results/sng_resteal_wide_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:resteal_rel=1.4,icm_tag:resteal_rel_bb=35,icm_tag:resteal_rel=1.4;resteal_rel_bb=35"
{
echo "# resteal wide fresh-seed validation (seeds 87000+, 600 paired tables)"
i=0
for cell in "--field field4" "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field default" "--field field2" "--field field3" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((87000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_resteal_wide_validate.tmp
mv results/logs/sng_resteal_wide_validate.tmp $OUT

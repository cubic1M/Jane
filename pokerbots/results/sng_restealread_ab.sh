#!/bin/bash
# Exploration: resteal_read (re-shove range x the opener's fold-to-re-raise rate / 0.65) with wider
# resteal_rel. f2_shark re-shoves ~32 times per table on field 4 (+2,498 chips/table); our 0.35 rule ~5.
# Seeds 84000+, 400 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_restealread_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:resteal_read=6,icm_tag:resteal_rel=0.5;resteal_read=6,icm_tag:resteal_rel=0.7;resteal_read=6"
{
echo "# resteal_read exploration (seeds 84000+, 400 paired tables)"
i=0
for cell in "--field field4" "--field $H" "--field all3" "--field field3" "--field field2" "--field mirror" "--preset rehearsal_sixplus --field custom:planb_sd=1"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((84000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_restealread_ab.tmp
mv results/logs/sng_restealread_ab.tmp $OUT

#!/bin/bash
# Exploration: f3_exploiter's re-shove rule (resteal_rel: re-shove a lone open at <= 28bb with the top
# rel x opener's open rate of hands). Its biggest chip source on field 4. Seeds 79000+, 400 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_restealrel_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:resteal_rel=0.25,icm_tag:resteal_rel=0.35,icm_tag:resteal_rel=0.5"
{
echo "# resteal_rel exploration (seeds 79000+, 400 paired tables)"
i=0
for cell in "--field field4" "--field all3" "--field field3" "--field field2" "--field $H" "--field mirror" "--preset rehearsal_sixplus --field custom:planb_sd=1"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((79000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_restealrel_ab.tmp
mv results/logs/sng_restealrel_ab.tmp $OUT

#!/bin/bash
# Fresh-seed validation of push_steal (seeds 68000+, 600 paired tables per cell).
cd "$(dirname "$0")/.."
OUT=results/sng_pushsteal_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:push_steal=0.5,icm_tag:push_steal=0.3"
{
echo "# push_steal fresh-seed validation (seeds 68000+, 600 paired tables)"
i=0
for cell in "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field default" "--field field2" "--field field3" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 2 --seed0 $((68000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_pushsteal_validate.tmp
mv results/logs/sng_pushsteal_validate.tmp $OUT

#!/bin/bash
# Exploration: the steal factor (fold read) on short-stack shoves (push_steal; Plan B does this).
# Seeds 66000+, 500 paired tables per cell.
cd "$(dirname "$0")/.."
OUT=results/sng_pushsteal_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:push_steal=0.5,icm_tag:push_steal=1"
{
echo "# push_steal exploration (seeds 66000+, 500 paired tables)"
i=0
for cell in "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field all3 --payouts top3" "--field field3" "--field field2" "--field $H" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 500 --workers 2 --seed0 $((66000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_pushsteal_ab.tmp
mv results/logs/sng_pushsteal_ab.tmp $OUT

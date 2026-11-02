#!/bin/bash
# Exploration: c-bet and bluff sizes (were fixed at half pot). Seeds 57000+, 500 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_betsize_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:cbet_size=0.33,icm_tag:cbet_size=0.75,icm_tag:bluff_size=0.33,icm_tag:bluff_size=0.75,icm_tag:cbet_size=0.33;bluff_size=0.33"
{
echo "# c-bet / bluff size exploration (seeds 57000+, 500 paired tables)"
i=0
for cell in "--field all3 --payouts top3" "--field field3" "--field field2" "--field $H"; do
  i=$((i+1)); echo -e "\n## ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((57000+100*i)) 2>&1 | grep -A8 "paired"
done
echo done
} > results/logs/sng_betsize_ab.tmp
mv results/logs/sng_betsize_ab.tmp $OUT

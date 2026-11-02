#!/bin/bash
# Tonight's total gain: current icm_tag vs the start-of-night bot (all five changes off). Seeds 47000+.
cd "$(dirname "$0")/.."
OUT=results/sng_tonight_total.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
OLD="icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6"
{
echo "# current icm_tag vs the start-of-night bot (fresh seeds 47000+, 600 paired tables)"
i=0
for cell in "--field default" "--field field2" "--field field3" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H"; do
  i=$((i+1)); echo -e "\n## ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "icm_tag,$OLD" --baseline "$OLD" --tables 600 --workers 3 --seed0 $((47000+100*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_tonight_total.tmp
mv results/logs/sng_tonight_total.tmp $OUT

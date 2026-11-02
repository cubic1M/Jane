#!/bin/bash
# Exploration: exact-ICM all-in calls (icm_call) vs pot odds + risk premium (seeds 38000+, 500 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_icm_call_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:icm_call=1;icm_margin=0.0,icm_tag:icm_call=1,icm_tag:icm_call=1;icm_margin=0.05"
{
echo "# icm_call exploration (seeds 38000+, 500 paired tables)"
i=0
for cell in "--field default" "--field field3" "--field all3 --payouts top3" "--field $H" "--field all3 --payouts flat8"; do
  i=$((i+1)); echo -e "\n## ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((38000+100*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_icm_call_ab.tmp
mv results/logs/sng_icm_call_ab.tmp $OUT

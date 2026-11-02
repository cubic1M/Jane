#!/bin/bash
# Fresh-seed validation of icm_call=1 (seeds 39000+, 600 paired tables per cell).
cd "$(dirname "$0")/.."
OUT=results/sng_icm_call_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
{
echo "# icm_call=1 fresh-seed validation (seeds 39000+, 600 paired tables)"
i=0
for cell in "--field default" "--field field2" "--field mirror" "--field all3 --payouts top3" "--field $H" "--field all3 --payouts winner"; do
  i=$((i+1)); echo -e "\n## ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "icm_tag,icm_tag:icm_call=1" --baseline icm_tag --tables 600 --workers 3 --seed0 $((39000+100*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_icm_call_validate.tmp
mv results/logs/sng_icm_call_validate.tmp $OUT

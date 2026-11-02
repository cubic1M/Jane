#!/bin/bash
# Fresh-seed validation of the tuner pick call_margin=0.09 (seeds 71000+, 600 paired tables per cell).
cd "$(dirname "$0")/.."
OUT=results/sng_callmargin_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:call_margin=0.09"
{
echo "# call_margin=0.09 fresh-seed validation (tuner pick; seeds 71000+, 600 paired tables)"
i=0
for cell in "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field default" "--field field2" "--field field3" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((71000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_callmargin_validate.tmp
mv results/logs/sng_callmargin_validate.tmp $OUT

#!/bin/bash
# Exploration: heads-up risk premium (hu_risk) and fading the premium near the hand cap (cap_fade).
# Seeds 52000+, 600 paired tables per cell.
cd "$(dirname "$0")/.."
OUT=results/sng_caprisk_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:hu_risk=0,icm_tag:hu_risk=0.5,icm_tag:cap_fade=25,icm_tag:cap_fade=50,icm_tag:hu_risk=0;cap_fade=50"
{
echo "# hu_risk / cap_fade exploration (seeds 52000+, 600 paired tables)"
i=0
for cell in "--field all3 --payouts top3" "--field field3" "--field field2" "--field $H"; do
  i=$((i+1)); echo -e "\n## ${cell:0:40}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((52000+100*i)) 2>&1 | grep -A8 "paired"
done
echo done
} > results/logs/sng_caprisk_ab.tmp
mv results/logs/sng_caprisk_ab.tmp $OUT

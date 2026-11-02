#!/bin/bash
# Validate risk_payout=1 (risk premium scaled by payout shape) on fresh seeds 28000+.
# It only changes play when 1st takes more than half the (shifted) points: winner, top2.
cd "$(dirname "$0")/.."
OUT=results/sng_risk_payout.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
echo "# risk_payout=1 validation (fresh seeds 28000+, 500 paired tables)" > $OUT
i=0
for pay in winner top2; do for f in default field2 field3 "$H"; do
  i=$((i+1))
  echo -e "\n## payouts=$pay field=${f:0:16}\n" >> $OUT
  python3 -m sng.arena --field "$f" --payouts $pay --candidates "icm_tag,icm_tag:risk_payout=1" \
    --baseline icm_tag --tables 500 --workers 3 --seed0 $((28000+100*i)) 2>&1 | grep -A2 "paired" >> $OUT
done; done
echo done >> $OUT

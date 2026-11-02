#!/bin/bash
# Does the ICM risk premium hurt under winner-heavy payouts? (seeds 27000+, 400 paired tables)
cd "$(dirname "$0")/.."
OUT=results/sng_winner_risk.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
echo "# Risk premium vs payout shape (seeds 27000+, 400 paired tables)" > $OUT
for f in "$H" all3; do for pay in winner top3; do
  echo -e "\n## field=${f:0:20} payouts=$pay\n" >> $OUT
  python3 -m sng.arena --field "$f" --payouts $pay --candidates "icm_tag,icm_tag:risk=0.0,icm_tag:risk=0.05,icm_tag:risk=0.2,f3_exploiter" \
    --baseline icm_tag --tables 400 --workers 3 --seed0 27000 2>&1 | grep -A6 "paired" >> $OUT
done; done
echo done >> $OUT

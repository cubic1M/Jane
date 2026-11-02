#!/bin/bash
# Fresh-seed validation of the winner-payout tuning (seeds 29000+, 500 paired tables per field).
cd "$(dirname "$0")/.."
OUT=results/sng_winner_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
echo "# Winner-payout tuning, fresh-seed validation (seeds 29000+, 500 paired tables)" > $OUT
i=0
for f in default field2 field3 "$H"; do
  i=$((i+1))
  echo -e "\n## payouts=winner field=${f:0:16}\n" >> $OUT
  python3 -m sng.arena --field "$f" --payouts winner --candidates "icm_tag,icm_tag:call_margin=0.09;range_k=3.2,icm_tag:call_margin=0.09,icm_tag:range_k=3.2,icm_tag:push_mult=0.9091" \
    --baseline icm_tag --tables 500 --workers 3 --seed0 $((29000+100*i)) 2>&1 | grep -A5 "paired" >> $OUT
done
echo done >> $OUT

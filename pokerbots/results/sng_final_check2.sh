#!/bin/bash
# Regression check 2 after adopting risk_payout and the heads-up ranges: current icm_tag vs each
# field's best bots, plus the pre-change bot (icm_tag with both switched off). Fresh seeds 37000+.
cd "$(dirname "$0")/.."
OUT=results/sng_final_check2.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
OLD="icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0"
{
echo "# current icm_tag vs each field's best and vs the pre-change bot (fresh seeds 37000+, 400 paired tables)"
i=0
for cell in "--field default|pushfold_icm,adaptive" "--field strong|pushfold_icm,adaptive" \
            "--field mirror|pushfold_icm,adaptive" "--field field2|f2_shark,f2_nash" \
            "--field field3|f3_exploiter,f3_quant_icm" "--field all3 --payouts top3|f3_exploiter,f2_shark" \
            "--field $H|f3_exploiter,f2_shark" "--field all3 --payouts winner|f3_exploiter,f2_shark"; do
  i=$((i+1)); args="${cell%%|*}"; others="${cell#*|}"
  echo -e "\n## ${args:0:40}\n"
  python3 -m sng.arena $args --candidates "icm_tag,$OLD,$others" --baseline icm_tag --tables 400 --workers 3 \
    --seed0 $((37000+i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_final_check2.tmp
mv results/logs/sng_final_check2.tmp $OUT

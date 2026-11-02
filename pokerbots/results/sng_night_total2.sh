#!/bin/bash
# Whole night: current icm_tag vs the start-of-night bot (OLD) and vs the bot before tonight's
# Plan B fixes (MID: behind_k / push_steal off). Fresh seeds 70000+, 600 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_night_total2.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
OLD="icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0"
MID="icm_tag:behind_k=0.8;push_steal=0"
{
echo "# current icm_tag vs start-of-night (OLD) and pre-Plan-B-fix (MID) bots (fresh seeds 70000+, 600 paired tables)"
i=0
for cell in "--field default" "--field field2" "--field field3" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H" "--field mirror" "--preset rehearsal_sixplus --field custom:planb_sd=1"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "icm_tag,$MID,$OLD" --baseline "$OLD" --tables 600 --workers 3 --seed0 $((70000+100*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_night_total2.tmp
mv results/logs/sng_night_total2.tmp $OUT

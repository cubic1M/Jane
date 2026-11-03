#!/bin/bash
# current vs start-of-night (seeds 113000+, 600 paired tables). Usage: sng_rscall_validate.sh 1|2 (cell halves).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0;resteal_rel=0;rs_call=0,icm_tag"
cells=("--field field4" "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field default" "--field field2" "--field field3" "--field field6"
       "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H" "--field mirror" "--field field5")
if [ "$1" = 1 ]; then idx="0 1 2 3 4 5"; else idx="6 7 8 9 10"; fi
OUT=results/sng_total4_$1.md
{
echo "# current icm_tag vs the start-of-night bot (all switches since off, incl. rs_call), part $1 (seeds 113000+, 600 paired tables)"
for i in $idx; do
  echo -e "\n## ${cells[$i]}\n"
  python3 -m sng.arena ${cells[$i]} --candidates "$C" --baseline "icm_tag:hu_open_mult=0;hu_range_k=0;risk_payout=0;icm_call=0;bet_discount=0.6;behind_k=0.8;push_steal=0;resteal_rel=0;rs_call=0" --tables 600 --workers 3 --seed0 $((113000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_total4_$1.tmp
mv results/logs/sng_total4_$1.tmp $OUT

#!/bin/bash
# rs_call=3 vs the default 2 (seeds 101000+, 600 paired tables). Usage: sng_rscall_validate.sh 1|2 (cell halves).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:rs_call=3"
cells=("--field field4" "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field default" "--field field2" "--field field3" "--field field6"
       "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H" "--field mirror" "--field field5")
if [ "$1" = 1 ]; then idx="0 1 2 3 4 5"; else idx="6 7 8 9 10"; fi
OUT=results/sng_rscall3_validate_$1.md
{
echo "# rs_call=3 vs the default 2, fresh-seed validation, part $1 (seeds 101000+, 600 paired tables)"
for i in $idx; do
  echo -e "\n## ${cells[$i]}\n"
  python3 -m sng.arena ${cells[$i]} --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((101000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_rscall3_validate_$1.tmp
mv results/logs/sng_rscall3_validate_$1.tmp $OUT

#!/bin/bash
# rfi_mode fresh-seed validation (seeds 151000+, 600 paired tables). Usage: sng_rfi_validate.sh 1|2|3 (cell thirds).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:rfi_mode=2;rfi_scale=1.3,icm_tag:rfi_mode=2;rfi_scale=1.5"
cells=("--field field4" "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field default" "--field field2" "--field field3"
       "--field field6" "--field field7" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H"
       "--field mirror" "--field field5" "--preset kit4_sixplus --field field4")
case "$1" in 1) idx="0 1 2 3 4";; 2) idx="5 6 7 8";; *) idx="9 10 11 12";; esac
OUT=results/sng_rfi2_validate_$1.md
{
echo "# rfi_mode=2 (full deck, not-top-heavy payouts only) fresh-seed validation, part $1 (seeds 151000+, 600 paired tables)"
for i in $idx; do
  echo -e "\n## ${cells[$i]}\n"
  python3 -m sng.arena ${cells[$i]} --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((151000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_rfi2_validate_$1.tmp
mv results/logs/sng_rfi2_validate_$1.tmp $OUT

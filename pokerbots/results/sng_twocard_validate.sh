#!/bin/bash
# icm_any 2-card mode (two_card=1: icm_tag's hold'em switches on 2-card games without discards) vs off,
# fresh seeds 121000+, 600 paired tables. Usage: sng_twocard_validate.sh 1|2 (kit-4 six-plus | plain NLHE).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_any:two_card=0,icm_any"
if [ "$1" = 1 ]; then RULES="--preset kit4_sixplus"; NAME="kit-4 six-plus"; else RULES=""; NAME="plain NLHE"; fi
OUT=results/sng_twocard_validate_$1.md
{
echo "# icm_any two_card=1 vs 0 on $NAME (seeds 121000+, 600 paired tables)"
i=0
for f in field4 field5 all3 "$H"; do
  i=$((i+1)); echo -e "\n## $f\n"
  python3 -m sng.arena $RULES --field "$f" --candidates "$C" --baseline icm_any:two_card=0 --tables 600 --workers 3 \
    --seed0 $((121000+10000*$1+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_twocard_validate_$1.tmp
mv results/logs/sng_twocard_validate_$1.tmp $OUT

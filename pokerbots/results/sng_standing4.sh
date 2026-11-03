#!/bin/bash
# Standings after rs_call=2: icm_tag vs the best bots of each field (seeds 109000+, 300 paired tables per field).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,f3_exploiter,f2_shark,f4_icm,f5_adapt,f6_checkraiser,pushfold_icm"
OUT=results/sng_standing4.md
{
echo "# Standings after rs_call=2 (seeds 109000+, 300 paired tables per field)"
i=0
for f in all3 field4 field5 "$H"; do
  i=$((i+1)); echo -e "\n## $f\n"
  python3 -m sng.arena --field "$f" --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((109000+1000*i)) 2>&1 | grep -E "^\| |paired|^  [a-z0-9_]+ +[-+]"
done
echo done
} > results/logs/sng_standing4.tmp
mv results/logs/sng_standing4.tmp $OUT

#!/bin/bash
# rs_call: my open re-raised all-in: the shover holds the top rs_call x (their re-raise rate) of hands.
# Exploration (seeds 64000+, 300 paired tables per cell). Found on field 6 (-3,200 chips/table folding to re-shoves).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:rs_call=2,icm_tag:rs_call=4,icm_tag:rs_call=6"
OUT=results/sng_rscall_ab.md
{
echo "# rs_call exploration (seeds 64000+, 300 paired tables)"
i=0
for c in "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((64000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_rscall_ab.tmp
mv results/logs/sng_rscall_ab.tmp $OUT

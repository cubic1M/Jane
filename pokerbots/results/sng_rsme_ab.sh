#!/bin/bash
# rs_me: rs_call reads the re-shover's re-raise rate vs MY opens (shrunk to its overall rate, prior 8 hands).
# Exploration (seeds 66000+, 300 paired tables per cell); field 6 still 17.5/table after rs_call=2.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:rs_me=8,icm_tag:rs_call=3;rs_me=8,icm_tag:rs_call=3"
OUT=results/sng_rsme_ab.md
{
echo "# rs_me exploration (rs_call 2 = current default) (seeds 66000+, 300 paired tables)"
i=0
for c in "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((66000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_rsme_ab.tmp
mv results/logs/sng_rsme_ab.tmp $OUT

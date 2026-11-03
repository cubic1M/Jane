#!/bin/bash
# push_bb: shove-or-fold at or below this stack instead of 2bb opens (field 6 re-shoves our 9-15bb opens).
# Exploration (seeds 103000+, 300 paired tables per cell); quick field 6 run: 12 +4.1*, 15 +8.4*.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:push_bb=12,icm_tag:push_bb=15"
OUT=results/sng_pushbb_ab.md
{
echo "# push_bb exploration (current 9) (seeds 103000+, 300 paired tables)"
i=0
for c in "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((103000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_pushbb_ab.tmp
mv results/logs/sng_pushbb_ab.tmp $OUT

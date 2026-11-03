#!/bin/bash
# open_mult: tighter first-in opens. Field 7 (re-raises 39-49% of my opens): 1.4 / 1.8 / 2.4 = +10.4* / +18.2* / +19.2*;
# an adaptive version (img_k) did not capture it. Exploration on 9 cells + field 7 (seeds 131000+, 300 paired tables).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:open_mult=1.3,icm_tag:open_mult=1.6"
OUT=results/sng_openmult_ab.md
{
echo "# open_mult exploration (current 1.07) (seeds 131000+, 300 paired tables)"
i=0
for c in "--field field7" "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((131000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_openmult_ab.tmp
mv results/logs/sng_openmult_ab.tmp $OUT

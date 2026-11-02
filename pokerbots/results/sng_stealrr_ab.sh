#!/bin/bash
# Exploration: steal read that discounts seats who re-raise opens (steal_rr). Field 4's adaptive bots
# re-steal; static fields do not. Seeds 78000+, 400 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_stealrr_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:steal_rr=1,icm_tag:steal_rr=2,icm_tag:steal_rr=3"
{
echo "# steal_rr exploration (seeds 78000+, 400 paired tables)"
i=0
for cell in "--field field4" "--field all3" "--field field3" "--field field2" "--field $H" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 2 --seed0 $((78000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_stealrr_ab.tmp
mv results/logs/sng_stealrr_ab.tmp $OUT

#!/bin/bash
# A hackathon-like field: many weak or broken bots (shove-happy, call-everything, random,
# buggy, slow ones that time out and fold) mixed with a few decent ones. Fresh seeds.
cd "$(dirname "$0")/.."
OUT=results/sng_hackfield.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
echo "# icm_tag on a hackathon-like field (fresh seeds 24000+, 400 paired tables)" > $OUT
for pay in synthetic top3 flat8; do
  echo -e "\n## payouts=$pay\n" >> $OUT
  python3 -m sng.arena --field "$H" --payouts $pay --candidates icm_tag,icm_lite,pushfold_icm,f3_exploiter,f2_shark,adaptive \
    --baseline icm_tag --tables 400 --workers 3 --seed0 24000 2>&1 | grep -v "tables (" >> $OUT
done
echo done >> $OUT

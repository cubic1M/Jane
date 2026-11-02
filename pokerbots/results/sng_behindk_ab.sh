#!/bin/bash
# Exploration: weight of opponents still to act when facing a preflop raise (behind_k; 0.8 = old).
# Found via the Plan B rehearsal bot, which counts only players who already put chips in.
# Seeds 61000+, 500 paired tables per cell.
cd "$(dirname "$0")/.."
OUT=results/sng_behindk_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:behind_k=0,icm_tag:behind_k=0.2,icm_tag:behind_k=0.4"
{
echo "# behind_k exploration (seeds 61000+, 500 paired tables)"
i=0
for cell in "--preset rehearsal_sixplus --field custom:planb_sd=1" "--field all3 --payouts top3" "--field field3" "--field field2" "--field $H" "--field mirror"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((61000+100*i)) 2>&1 | grep -A6 "paired"
done
echo done
} > results/logs/sng_behindk_ab.tmp
mv results/logs/sng_behindk_ab.tmp $OUT

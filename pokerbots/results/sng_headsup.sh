#!/bin/bash
# Short-handed and heads-up strength: icm_tag vs each field's best bots on 2- and 3-player
# tables (the end of every 8-player table that does not reach the hand cap). Seeds 30000+.
cd "$(dirname "$0")/.."
OUT=results/sng_headsup.md
echo "# Heads-up and 3-handed (seeds 30000+, 600 paired tables per cell; payouts = top N of synthetic)" > $OUT
i=0
for np in 2 3; do for f in all3 default field3; do
  i=$((i+1))
  echo -e "\n## players=$np field=$f\n" >> $OUT
  python3 -m sng.arena --players $np --field $f --candidates "icm_tag,pushfold_icm,f3_exploiter,f2_shark,f2_nash,adaptive" \
    --baseline icm_tag --tables 600 --workers 3 --seed0 $((30000+100*i)) 2>&1 | grep -B12 -A7 "paired" | grep -E "^\| (icm_tag|bot)|^  |paired" >> $OUT
done; done
echo done >> $OUT

#!/bin/bash
# Exploration: re-steal shoves (resteal) and the fold-equity push model (pev), both with the corrected
# range-to-k mapping (seeds 48000+, 500 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_resteal_ab.md
C="icm_tag,icm_tag:resteal=1;resteal_risk=0.25,icm_tag:resteal=1;resteal_risk=0.5,icm_tag:pev=1;pev_risk=0.25,icm_tag:pev=1;pev_risk=0.5,icm_tag:resteal=1;resteal_risk=0.25;pev=1;pev_risk=0.25"
{
echo "# resteal / pev (corrected range mapping) exploration (seeds 48000+, 500 paired tables)"
i=0
for cell in "--field field2" "--field all3 --payouts top3" "--field default"; do
  i=$((i+1)); echo -e "\n## $cell\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((48000+100*i)) 2>&1 | grep -A6 "paired"
done
echo done
} > results/logs/sng_resteal_ab.tmp
mv results/logs/sng_resteal_ab.tmp $OUT

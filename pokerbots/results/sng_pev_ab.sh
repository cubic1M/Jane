#!/bin/bash
# Exploration: fold-equity push model (pev) vs the fixed push bar (seeds 44000+, 500 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_pev_ab.md
C="icm_tag,icm_tag:pev=1;pev_risk=0,icm_tag:pev=1;pev_risk=0.25,icm_tag:pev=1;pev_risk=0.5,icm_tag:pev=1;pev_risk=0;pev_bb=11,icm_tag:pev=1;pev_risk=0.25;pev_loose=1.3"
{
echo "# pev exploration (seeds 44000+, 500 paired tables)"
i=0
for cell in "--field field2" "--field all3 --payouts top3" "--field default"; do
  i=$((i+1)); echo -e "\n## $cell\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((44000+100*i)) 2>&1 | grep -A6 "paired"
done
echo done
} > results/logs/sng_pev_ab.tmp
mv results/logs/sng_pev_ab.tmp $OUT

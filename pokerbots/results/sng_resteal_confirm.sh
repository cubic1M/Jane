#!/bin/bash
# Confirmation on the borderline cells before adopting resteal+pev (seeds 50000+, 800 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_resteal_confirm.md
C="icm_tag,icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5"
{
echo "# resteal+pev confirmation (seeds 50000+, 800 paired tables)"
i=0
for cell in "--field field3" "--field all3 --payouts top3" "--field all3"; do
  i=$((i+1)); echo -e "\n## $cell\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 800 --workers 3 --seed0 $((50000+100*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_resteal_confirm.tmp
mv results/logs/sng_resteal_confirm.tmp $OUT

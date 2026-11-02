#!/bin/bash
# hu_risk on heads-up tables (every decision affected), seeds 54000+, 800 paired tables per cell.
cd "$(dirname "$0")/.."
OUT=results/sng_hurisk_ab.md
C="icm_tag,icm_tag:hu_risk=0,icm_tag:hu_risk=0.5"
{
echo "# hu_risk on heads-up tables (seeds 54000+, 800 paired tables)"
i=0
for cell in "--field all3" "--field field3" "--field field2" "--field all3 --payouts winner"; do
  i=$((i+1)); echo -e "\n## players 2 ${cell}\n"
  python3 -m sng.arena --players 2 $cell --candidates "$C" --baseline icm_tag --tables 800 --workers 3 --seed0 $((54000+100*i)) 2>&1 | grep -A5 "paired"
done
echo done
} > results/logs/sng_hurisk_ab.tmp
mv results/logs/sng_hurisk_ab.tmp $OUT

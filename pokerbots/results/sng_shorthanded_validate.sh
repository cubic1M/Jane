#!/bin/bash
# Fresh-seed check of the 3-handed signal (seeds 35000+, 800 paired tables per field).
cd "$(dirname "$0")/.."
OUT=results/sng_shorthanded_validate.md
C="icm_tag,icm_tag:sh_open_mult=0.95,icm_tag:sh_open_mult=0.9;sh_range_k=3.0"
{
echo "# Short-handed switches, fresh-seed check (players=3, seeds 35000+, 800 paired tables)"
i=0
for f in default field2 field3; do
  i=$((i+1)); echo -e "\n## players=3 field=$f\n"
  python3 -m sng.arena --players 3 --field $f --candidates "$C" --baseline icm_tag --tables 800 --workers 3 --seed0 $((35000+100*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_shorthanded_validate.tmp
mv results/logs/sng_shorthanded_validate.tmp $OUT

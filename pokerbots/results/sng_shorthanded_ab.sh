#!/bin/bash
# Exploration: 3-4 handed open / defence switches (all3 field, seeds 34000+, 600 paired tables).
cd "$(dirname "$0")/.."
OUT=results/sng_shorthanded_ab.md
C="icm_tag,icm_tag:sh_open_mult=0.95,icm_tag:sh_open_mult=0.85,icm_tag:sh_range_k=3.2,icm_tag:sh_range_k=2.6,icm_tag:sh_open_mult=0.9;sh_range_k=3.0"
{
echo "# Short-handed switches, exploration (all3 field, seeds 34000+, 600 paired tables)"
for np in 3 4; do
  echo -e "\n## players=$np\n"
  python3 -m sng.arena --players $np --field all3 --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((34000+np*100)) 2>&1 | grep -A6 "paired"
done
echo done
} > results/logs/sng_shorthanded_ab.tmp
mv results/logs/sng_shorthanded_ab.tmp $OUT

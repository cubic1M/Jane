#!/bin/bash
# Is the Plan B bot stronger than icm_tag in general, or only among its own copies?
# Rehearsal six-plus preset, seeds 65000+, 400 paired tables per field.
cd "$(dirname "$0")/.."
OUT=results/sng_planb_fields.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
{
echo "# planb_sd vs icm_tag across fields (rehearsal six-plus, seeds 65000+, 400 paired tables)"
i=0
for f in "custom:icm_tag=1" "all3" "$H"; do
  i=$((i+1)); echo -e "\n## ${f:0:40}\n"
  python3 -m sng.arena --preset rehearsal_sixplus --field "$f" --candidates "icm_tag,planb_sd" --baseline icm_tag --tables 400 --workers 2 --seed0 $((65000+100*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_planb_fields.tmp
mv results/logs/sng_planb_fields.tmp $OUT

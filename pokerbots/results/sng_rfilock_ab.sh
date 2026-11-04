#!/bin/bash
# rfi_lock: start with the wide bar; after 20 opens, if >= rfi_lock of them were re-raised, use rfi_mode=2 ranges for the rest
# of the table (one-way). Quick (150 tables, lock 0.3): field 7 +7.0*, field 5 -1.8, default +1.9, field 3 +1.1.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:rfi_lock=0.3;rfi_scale=1.3,icm_tag:rfi_lock=0.25;rfi_scale=1.3"
OUT=results/sng_rfilock_ab.md
{
echo "# rfi_lock exploration (switch to position ranges once >= x of my opens were re-raised) (seeds 157000+, 300 paired tables)"
i=0
for c in "--field field7" "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((157000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_rfilock_ab.tmp
mv results/logs/sng_rfilock_ab.tmp $OUT

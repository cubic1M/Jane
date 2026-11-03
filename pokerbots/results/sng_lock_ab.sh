#!/bin/bash
# lock_mult: after lock_min opens, if >= lock_share of them were re-raised, open bar x lock_mult for the rest of the table.
# Quick: field 7 +4.9* (lock 1.8 / 0.3), field 3 -0.4. Exploration on 10 cells (seeds 137000+, 300 paired tables).
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:lock_mult=1.8;lock_share=0.3,icm_tag:lock_mult=2.0;lock_share=0.3;lock_min=15"
OUT=results/sng_lock_ab.md
{
echo "# lock_mult exploration (one-way tight-open lock when my opens get re-raised) (seeds 137000+, 300 paired tables)"
i=0
for c in "--field field7" "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((137000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_lock_ab.tmp
mv results/logs/sng_lock_ab.tmp $OUT

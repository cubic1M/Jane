#!/bin/bash
# Fresh-seed validation of the heads-up switches (seeds 33000+): heads-up tables on four
# fields, then full 8-player tables (the switches act only once a table is heads-up).
cd "$(dirname "$0")/.."
OUT=results/sng_headsup_validate.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:hu_open_mult=0.7;hu_range_k=2.0,icm_tag:hu_open_mult=0.6;hu_range_k=2.0"
{
echo "# Heads-up switches, fresh-seed validation (seeds 33000+)"
i=0
for f in default field2 field3 "$H"; do
  i=$((i+1)); echo -e "\n## players=2 field=${f:0:16} (800 paired tables)\n"
  python3 -m sng.arena --players 2 --field "$f" --candidates "$C" --baseline icm_tag --tables 800 --workers 3 --seed0 $((33000+100*i)) 2>&1 | grep -A3 "paired"
done
for f in default field3 all3; do
  i=$((i+1)); echo -e "\n## players=8 field=$f (500 paired tables)\n"
  python3 -m sng.arena --field "$f" --candidates "$C" --baseline icm_tag --tables 500 --workers 3 --seed0 $((33000+100*i)) 2>&1 | grep -A3 "paired"
done
echo done
} > results/logs/sng_headsup_validate.tmp
mv results/logs/sng_headsup_validate.tmp $OUT

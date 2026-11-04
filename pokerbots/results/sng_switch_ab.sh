#!/bin/bash
# rfi_mode: our first-in opens are ~34% from EVERY position (bar open_mult/(k+1)); rfi_mode opens 40% ... 11%
# by players behind (f2_shark-style), scaled by rfi_scale and the steal factor. Quick: field 7 +7.6* at 1.3.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_switch"
OUT=results/sng_switch_ab.md
{
echo "# icm_switch exploration (icm_tag until attacked, then f7_balanced), no time limit (seeds 183000+, 300 paired tables)"
i=0
for c in "--field field8" "--field field7" "--field field6" "--field field5" "--field field4" "--field all3" "--field $H" "--field default" "--field mirror" "--field field2" "--field field3"; do
  i=$((i+1)); echo -e "\n## $c\n"
  python3 -m sng.arena $c --candidates "$C" --no-enforce --baseline icm_tag --tables 300 --workers 3 --seed0 $((183000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_switch_ab.tmp
mv results/logs/sng_switch_ab.tmp $OUT

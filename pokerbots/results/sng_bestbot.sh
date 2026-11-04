#!/bin/bash
# Which bot should we submit? icm_tag vs the strongest other bots we own, in every field (each bot takes
# one seat; the rest is the field), plus the champions table. Time limit off (a loaded host must not decide
# this; speed is checked separately). Seeds 173000+, 300 paired tables. Usage: sng_bestbot.sh 1|2|3
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,f2_shark,f3_exploiter,f7_balanced"
cells=("--field default" "--field field2" "--field field3" "--field field4" "--field field5"
       "--field field6" "--field field7" "--field all3 --payouts top3" "--field all3 --payouts winner" "--field $H"
       "--field $CH" "--field $CH --payouts top3" "--preset kit4_sixplus --field $CH" "--preset kit4_sixplus --field field4")
case "$1" in 1) idx="0 1 2 3 4";; 2) idx="5 6 7 8 9";; *) idx="10 11 12 13";; esac
OUT=results/sng_bestbot_$1.md
{
echo "# Which bot to submit: icm_tag vs f2_shark / f3_exploiter / f7_balanced, part $1 (seeds 173000+, 300 paired tables, no time limit)"
for i in $idx; do
  echo -e "\n## ${cells[$i]}\n"
  python3 -m sng.arena ${cells[$i]} --no-enforce --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((173000+1000*i)) 2>&1 | grep -E "^\| (icm_tag|f2_shark|f3_exploiter|f7_balanced) |paired|^  [a-z0-9_]+ +[-+]"
done
echo done
} > results/logs/sng_bestbot_$1.tmp
mv results/logs/sng_bestbot_$1.tmp $OUT

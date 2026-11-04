#!/bin/bash
# Champions league: tables of the best bot from every field (plus ours), under three payout / card setups.
# Seeds 167000+, 400 paired tables.
cd "$(dirname "$0")/.."
F="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,f2_shark,f3_exploiter,f4_icm,f5_adapt,f6_checkraiser,f7_balanced,f7_profiler"
OUT=results/sng_champions.md
{
echo "# Champions league: the best bots of every field (seeds 167000+, 400 paired tables)"
i=0
for setup in "" "--payouts top3" "--preset kit4_sixplus"; do
  i=$((i+1)); echo -e "\n## champions ${setup:-(default rules)}\n"
  python3 -m sng.arena --field "$F" $setup --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((167000+1000*i)) 2>&1 | grep -E "^\| |paired|^  [a-z0-9_]+ +[-+]"
done
echo done
} > results/logs/sng_champions.tmp
mv results/logs/sng_champions.tmp $OUT

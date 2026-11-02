#!/bin/bash
# Exploration: ICM push/fold equilibrium charts (pf_chart=1) with the current bot; +4.1* on field 4,
# lost on mirror in an older test (results/sng_pushfold_ab.md). Seeds 75000+, 400 paired tables.
cd "$(dirname "$0")/.."
OUT=results/sng_pfchart_ab.md
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
C="icm_tag,icm_tag:pf_chart=1;pf_max_bb=10,icm_tag:pf_chart=1"
{
echo "# pf_chart exploration (seeds 75000+, 400 paired tables)"
i=0
for cell in "--field field4" "--field field2" "--field field3" "--field default" "--field mirror" "--field all3 --payouts top3" "--field $H"; do
  i=$((i+1)); echo -e "\n## ${cell:0:50}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 2 --seed0 $((75000+100*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_pfchart_ab.tmp
mv results/logs/sng_pfchart_ab.tmp $OUT

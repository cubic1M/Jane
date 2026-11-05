#!/bin/bash
# icm_switch (default) and the strong-room resubmit vs icm_tag in a field of the 8 strongest unseen opponents
# (top of the results/sng_unseen_check.md standing): a hard-room check against bots we never tuned on.
# Fresh seeds 631000+, 400 paired tables per cell, baseline icm_tag, time limit on, 2 workers (bug hunter alongside). Resumable.
cd "$(dirname "$0")/.."
T="custom:f7_bully=1,f9_gto=1,f9_limptrap=1,f8_nash=1,f8_solver=1,f6_raiser=1,f8_endgame=1,f3_quant_icm=1"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_unseen_top.md
TMP=results/logs/sng_unseen_top.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# icm_switch + strong-room option vs icm_tag among the 8 strongest unseen opponents, seeds 631000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field $T" "--field $T --payouts top3" "--field $T --players 6"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: unseen-top ${cell#--field $T}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 2 --seed0 $((631000+1000*i)) 2>&1 | grep -B4 -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

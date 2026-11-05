#!/bin/bash
# Unseen opponents part 2: icm_switch (default) and the strong-room resubmit vs icm_tag in the 31-bot unseen field
# under bounties and fixed-limit betting, and among the 8 strongest unseen bots with winner-take-all payouts.
# Fresh seeds 651000+, 400 paired tables per cell, baseline icm_tag, time limit on, 2 workers (bug hunter alongside). Resumable.
cd "$(dirname "$0")/.."
U=$(grep '^U=' results/sng_unseen_check.sh | cut -d'"' -f2)
T=$(grep '^T=' results/sng_unseen_top.sh | cut -d'"' -f2)
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_unseen_check2.md
TMP=results/logs/sng_unseen_check2.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# Unseen opponents part 2: icm_switch + strong-room option vs icm_tag, seeds 651000+ (400 paired tables)" > $TMP
{
i=0
for cell in "unseen|--field $U --preset bounty10" "unseen|--field $U --preset fixed_limit" "unseen-top|--field $T --payouts winner"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  name=${cell%%|*}; args=${cell#*|}
  echo -e "\n## cell $i: $name ${args##*--field * }\n"
  python3 -m sng.arena $args --candidates "$C" --baseline icm_tag --tables 400 --workers 2 --seed0 $((651000+1000*i)) 2>&1 | grep -B4 -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

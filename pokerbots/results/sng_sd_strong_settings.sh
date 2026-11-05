#!/bin/bash
# Short deck: the short-deck submission (strong-room option, f9_min_left=6) vs icm_switch under other payouts and table
# sizes, in the room guess and the 31-bot unseen field. Fresh seeds 691000+, 400 paired tables per cell, 2 workers. Resumable.
cd "$(dirname "$0")/.."
ROOM=$(grep '^ROOM=' results/sng_newfield_check2.sh | cut -d'"' -f2)
U=$(grep '^U=' results/sng_unseen_check.sh | cut -d'"' -f2)
C="icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6"
OUT=results/sng_sd_strong_settings.md
TMP=results/logs/sng_sd_strong_settings.tmp
DONE=$(grep -c "switch_min=15;f9_min_left=6 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# Short deck (kit-4 six-plus): strong-room option + f9_min_left=6 vs icm_switch, other settings, seeds 691000+ (400 paired tables)" > $TMP
{
i=0
for cell in "room|--field $ROOM --payouts top3" "room|--field $ROOM --payouts winner" "room|--field $ROOM --players 6" "unseen|--field $U" "unseen|--field $U --payouts top3"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  name=${cell%%|*}; args=${cell#*|}
  echo -e "\n## cell $i: $name ${args##*--field * }\n"
  python3 -m sng.arena $args --preset kit4_sixplus --candidates "$C" --baseline icm_switch --tables 400 --workers 2 --seed0 $((691000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

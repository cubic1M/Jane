#!/bin/bash
# Short deck with Triton rules (--variant e_shortdeck, 52-card blinds/payouts) instead of the kit six-plus presets:
# does the short-deck submission (strong-room option, f9_min_left=6) still beat icm_switch? Room guess, field 5, field 10,
# Plan B field. Fresh seeds 701000+, 400 paired tables per cell, baseline icm_switch, 2 workers. Resumable.
cd "$(dirname "$0")/.."
ROOM=$(grep '^ROOM=' results/sng_newfield_check2.sh | cut -d'"' -f2)
C="icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6"
OUT=results/sng_sd_triton_check.md
TMP=results/logs/sng_sd_triton_check.tmp
DONE=$(grep -c "switch_min=15;f9_min_left=6 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# Triton short deck: short-deck submission vs icm_switch, seeds 701000+ (400 paired tables)" > $TMP
{
i=0
for cell in "room|$ROOM" "field5|field5" "field10|field10" "planb|custom:planb_sd=1"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell%%|*} --variant e_shortdeck\n"
  python3 -m sng.arena --field "${cell#*|}" --variant e_shortdeck --candidates "$C" --baseline icm_switch --tables 400 --workers 2 --seed0 $((701000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

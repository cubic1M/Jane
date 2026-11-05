#!/bin/bash
# Short deck, decision-only interfaces: does the strong-room option with f9_min_left=6 (no field-9 ICM while 7-8 alive)
# keep its edge over icm_switch? Fresh seeds 681000+, 400 paired tables per cell, baseline icm_switch, 2 workers. Resumable.
cd "$(dirname "$0")/.."
ROOM=$(grep '^ROOM=' results/sng_newfield_check2.sh | cut -d'"' -f2)
C="icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15,icm_switch:start=b;back_share=0.22;switch_min=15;f9_min_left=6"
OUT=results/sng_sd_strong_fast.md
TMP=results/logs/sng_sd_strong_fast.tmp
DONE=$(grep -c "switch_min=15;f9_min_left=6 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# Short deck: strong-room option exact vs f9_min_left=6, vs icm_switch, seeds 681000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field custom:planb_sd=1" "--field $ROOM" "--field field10" "--field field5"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: ${cell:0:30} --preset kit4_sixplus\n"
  python3 -m sng.arena $cell --preset kit4_sixplus --candidates "$C" --baseline icm_switch --tables 400 --workers 2 --seed0 $((681000+1000*i)) 2>&1 | grep -A3 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

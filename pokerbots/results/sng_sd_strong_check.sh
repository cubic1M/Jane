#!/bin/bash
# Short deck only: the strong-room option vs icm_switch on the fields where it lost in hold'em (field 5 tight static,
# field 10 team bots, field 3), plus the rehearsal six-plus field 5. If no significant loss here, the strong-room option
# could be the short-deck default. Fresh seeds 671000+, 400 paired tables per cell, baseline icm_switch, 2 workers. Resumable.
cd "$(dirname "$0")/.."
C="icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_sd_strong_check.md
TMP=results/logs/sng_sd_strong_check.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# Short deck: strong-room option vs icm_switch on tight / team fields, seeds 671000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field field5 --preset kit4_sixplus" "--field field10 --preset kit4_sixplus" "--field field3 --preset kit4_sixplus" "--field field5 --preset rehearsal_sixplus"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: $cell\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 400 --workers 2 --seed0 $((671000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

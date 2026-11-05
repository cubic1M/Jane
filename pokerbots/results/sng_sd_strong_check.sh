#!/bin/bash
# Short deck only: the strong-room option vs icm_switch on the fields where it lost in hold'em (field 5 tight static,
# field 10 team bots, field 3), plus the rehearsal six-plus field 5. If no significant loss here, the strong-room option
# could be the short-deck default. Cells 5-7: the Plan B field (both six-plus rule sets) and the room guess. Fresh seeds 671000+, 400 paired tables per cell, baseline icm_switch, 2 workers. Resumable.
cd "$(dirname "$0")/.."
ROOM="custom:f10_chen=2,f10_montecarlo=2,f10_pushfold=2,f10_llm_rules=2,f10_aggro=2,f10_passive=2,f10_tag_simple=2,f10_exploit_lite=2,chen_tag=1,pushfold_icm=1,f2_shark=1,f3_exploiter=1,f4_icm=1,f5_reg=1,f5_nash=1,nit=1,f9_meta=1,f9_threebet=1,f9_bubble=1,f8_ensemble=1,f8_adaptive=1,f7_balanced=1,f7_profiler=1,f9_float=1"
C="icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_sd_strong_check.md
TMP=results/logs/sng_sd_strong_check.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# Short deck: strong-room option vs icm_switch on tight / team fields, seeds 671000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field field5 --preset kit4_sixplus" "--field field10 --preset kit4_sixplus" "--field field3 --preset kit4_sixplus" "--field field5 --preset rehearsal_sixplus" \
            "--field custom:planb_sd=1 --preset rehearsal_sixplus" "--field custom:planb_sd=1 --preset kit4_sixplus" \
            "--field $ROOM --preset kit4_sixplus"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: $cell\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 400 --workers 2 --seed0 $((671000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

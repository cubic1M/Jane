#!/bin/bash
# Stricter 52-card hand-over for icm_switch (field 5 misfire, -2.3*): the share rule with more opens / a higher share
# instead of the lock. Exploration, 400 paired tables x 8 cells, seeds 371000+, baseline icm_switch.
cd "$(dirname "$0")/.."
MIX="custom:f2_shark=1,f3_exploiter=1,f7_balanced=1,f8_ensemble=1,f8_nash=1,f9_threebet=1,f9_limptrap=1,f9_bubble=1,f9_float=1,f9_gto=1,f9_meta=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_switch,icm_switch:switch_min=30;switch_share=0.3,icm_switch:switch_min=25;switch_share=0.33,icm_switch:switch_min=20;switch_share=0.35,icm_tag"
OUT=results/sng_strict_ab.md
TMP=results/logs/sng_strict_ab.tmp
# resumable (container restarts): keep finished cells of an earlier partial run, same seeds per cell
DONE=$(grep -c "^  icm_tag" $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# stricter 52-card hand-over exploration, seeds 371000+ (400 paired tables, baseline icm_switch)" > $TMP
if [ "$DONE" != 0 ]; then python3 - "$TMP" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read(); k=s.rfind("  icm_tag"); open(p,"w").write(s[:s.index("\n", k)+1])
PY
fi
{
i=0
for cell in "--field field5" "--field field3" "--field default" "--field field10" "--field field7" "--field $CH" "--field $MIX" "--field field6"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_switch --tables 400 --workers 3 --seed0 $((371000+1000*i)) 2>&1 | grep -A5 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

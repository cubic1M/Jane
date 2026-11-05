#!/bin/bash
# icm_switch (default) and the strong-room resubmit vs icm_tag in the widest room we can build: the regional-room
# guess (ROOM, 24 bots) plus the 31 unseen opponents, each seat drawn from all 55. Standard rules and kit-4 six-plus.
# Fresh seeds 661000+, 600 paired tables per cell, baseline icm_tag, time limit on, 2 workers (bug hunter alongside). Resumable.
cd "$(dirname "$0")/.."
R=$(grep '^ROOM=' results/sng_newfield_check2.sh | cut -d'"' -f2)
U=$(grep '^U=' results/sng_unseen_check.sh | cut -d'"' -f2)
A="$R,${U#custom:}"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_allbots_check.md
TMP=results/logs/sng_allbots_check.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# icm_switch + strong-room option vs icm_tag in an all-55-bot room (ROOM + unseen), seeds 661000+ (600 paired tables)" > $TMP
{
i=0
for extra in "" "--preset kit4_sixplus"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: all-bots $extra\n"
  python3 -m sng.arena --field "$A" $extra --candidates "$C" --baseline icm_tag --tables 600 --workers 2 --seed0 $((661000+1000*i)) 2>&1 | grep -B4 -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

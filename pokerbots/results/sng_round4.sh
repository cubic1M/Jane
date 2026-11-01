#!/bin/bash
# Round 4 evaluations, 2 workers (less timing noise): fair discard/draw comparison, then field 3.
cd "$(dirname "$0")/.."
OUT=results/sng_discards.md
echo "# discard/draw variants, fair: every bot without its own discard logic uses the shared policy (300 paired tables, fresh seeds 15000+, 2 workers)" > $OUT
i=0
for p in discard_to_board omaha_discard2 draw_holdem five_draw; do
  i=$((i+1)); echo -e "\n## $p\n" >> $OUT
  python3 -m sng.arena --preset $p --candidates icm_any,icm_tag,pushfold_icm,chen_tag --baseline icm_any \
    --tables 300 --workers 2 --seed0 $((15000+i)) 2>&1 | grep -v "tables (" | sed -n '1,13p' >> $OUT
done
OUT=results/sng_field3.md
echo "# out of sample: field 3 (400 paired tables, fresh seeds 16000+, 2 workers)" > $OUT
for pay in synthetic top3; do
  echo -e "\n## payouts=$pay\n" >> $OUT
  python3 -m sng.arena --field field3 --payouts $pay --candidates icm_tag,f3_exploiter,f3_quant_icm,f3_ladder_pro,pushfold_icm,icm_lite \
    --baseline icm_tag --tables 400 --workers 2 --seed0 16000 2>&1 | grep -v "tables (" | sed -n '1,26p' >> $OUT
done
echo done >> results/sng_field3.md

#!/bin/bash
# Regression check of the current icm_tag against each field's best bots (fresh seeds 21000+).
cd "$(dirname "$0")/.."
OUT=results/sng_final_check.md
echo "# current icm_tag vs each field's best (fresh seeds 21000+, 300 paired tables, 2 workers)" > $OUT
i=0
for cell in "--field default:pushfold_icm,adaptive,chen_tag" "--field strong:pushfold_icm,adaptive,chen_tag" \
            "--field mirror:pushfold_icm,adaptive,chen_tag" "--field field2:f2_shark,f2_nash,f2_bubble" \
            "--field field3:f3_exploiter,f3_quant_icm,f3_ladder_pro" "--field all3 --payouts top3:f3_exploiter,f2_shark,pushfold_icm"; do
  i=$((i+1)); args="${cell%%:*}"; others="${cell#*:}"
  echo -e "\n## $args\n" >> $OUT
  python3 -m sng.arena $args --candidates "icm_tag,$others" --baseline icm_tag --tables 300 --workers 2 \
    --seed0 $((21000+i)) 2>&1 | grep -v "tables (" | sed -n '1,10p' >> $OUT
done
echo done >> $OUT

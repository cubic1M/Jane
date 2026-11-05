#!/bin/bash
# icm_switch (default) and the strong-room resubmit vs icm_tag in a field of the opponent bots that are NOT in our
# standard test fields (ROOM / H / CH): a check that we did not over-fit to the opponents we tune against.
# Fresh seeds 621000+, 400 paired tables per cell, baseline icm_tag, time limit on. Resumable.
cd "$(dirname "$0")/.."
U="custom:f2_bubble=1,f2_equity=1,f2_exploit=1,f2_gto=1,f2_nash=1,f3_generic=1,f3_ladder_pro=1,f3_quant_icm=1,f3_survivor=1,f4_eqrule=1,f4_gto=1,f4_lag=1,f4_mc=1,f4_tag=1,f5_bully=1,f5_trapper=1,f6_floater=1,f6_overbettor=1,f6_raiser=1,f6_riverbluffer=1,f7_bully=1,f7_hackathon=1,f7_trickster=1,f8_endgame=1,f8_nash=1,f8_solver=1,f9_gto=1,f9_limptrap=1,adaptive=1,mc_fast=1,station0=1"
C="icm_tag,icm_switch,icm_switch:start=b;back_share=0.22;switch_min=15"
OUT=results/sng_unseen_check.md
TMP=results/logs/sng_unseen_check.tmp
DONE=$(grep -c "start=b;back_share=0.22;switch_min=15 " $TMP 2>/dev/null); DONE=${DONE:-0}
[ "$DONE" = 0 ] && echo "# icm_switch + strong-room option vs icm_tag in a field of unseen opponents, seeds 621000+ (400 paired tables)" > $TMP
{
i=0
for cell in "--field $U" "--field $U --payouts top3" "--field $U --preset kit4_sixplus"; do
  i=$((i+1)); [ $i -le "$DONE" ] && continue
  echo -e "\n## cell $i: unseen ${cell#--field $U}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 400 --workers 3 --seed0 $((621000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} >> $TMP
mv $TMP $OUT

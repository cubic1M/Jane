#!/bin/bash
# Short-deck hand-over to f9_meta (share rule 0.30 after 20 opens, any deck) - fresh-seed validation on short-deck
# cells only. 600 paired tables, seeds 331000+.
cd "$(dirname "$0")/.."
H="custom:push=2,maniac=2,station=2,random=1,f3_buggy=1,f3_shover=1,mc_slow=1,nit=1,lag=1,chen_tag=1,f2_shark=1,f3_exploiter=1,pushfold_icm=1"
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_switch:b=f9_meta;switch_share=0.3;any_deck=1"
OUT=results/sng_sdswitch_validate.md
{
echo "# short-deck hand-over to f9_meta validation, fresh seeds 331000+ (600 paired tables)"
i=0
for cell in "--preset kit4_sixplus --field field5" "--preset kit4_sixplus --field field4" "--preset kit4_sixplus --field all3" \
            "--preset kit4_sixplus --field $H" "--preset kit4_sixplus --field field9" "--preset kit4_sixplus --field $CH" \
            "--preset kit4_sixplus --field field7" "--preset rehearsal_sixplus --field custom:planb_sd=7" \
            "--variant e_shortdeck --field field5" "--variant e_shortdeck --field field9"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((331000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_sdswitch_validate.tmp
mv results/logs/sng_sdswitch_validate.tmp $OUT

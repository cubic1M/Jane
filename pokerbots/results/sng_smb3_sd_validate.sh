#!/bin/bash
# steal_max_behind=3 on short-deck games other than kit 4 (rule candidate: smb=3 only when the deck has < 52
# cards). Fresh seeds 211000+, 600 paired tables.
cd "$(dirname "$0")/.."
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_tag:steal_max_behind=3"
OUT=results/sng_smb3_sd_validate.md
{
echo "# steal_max_behind=3 vs 5 on short deck, fresh seeds 211000+ (600 paired tables)"
i=0
for cell in "--preset rehearsal_sixplus --field field5" "--preset rehearsal_sixplus --field field4" \
            "--preset rehearsal_sixplus --field all3" "--preset rehearsal_sixplus --field custom:planb_sd=7" \
            "--preset rehearsal_sixplus --field $CH" "--variant e_shortdeck --field field5" \
            "--variant e_shortdeck --field field3" "--variant e_shortdeck --field default"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 600 --workers 3 --seed0 $((211000+1000*i)) 2>&1 | grep -A2 "paired"
done
echo done
} > results/logs/sng_smb3_sd_validate.tmp
mv results/logs/sng_smb3_sd_validate.tmp $OUT

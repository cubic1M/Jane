#!/bin/bash
# smb_rr: steal_max_behind -> 3 only once my opens get re-raised >= smb_rr (after rfi_lock_min opens).
# Exploration, 300 paired tables x 10 cells, seeds 221000+.
cd "$(dirname "$0")/.."
CH="custom:f2_shark=1,f3_exploiter=1,f4_icm=1,f5_adapt=1,f5_nash=1,f6_checkraiser=1,f7_balanced=1,f7_profiler=1,pushfold_icm=1"
C="icm_tag,icm_tag:smb_rr=0.25,icm_tag:smb_rr=0.3,icm_tag:smb_rr=0.35"
OUT=results/sng_smbrr_ab.md
{
echo "# smb_rr exploration, seeds 221000+ (300 paired tables)"
i=0
for cell in "--field field5" "--field default" "--field field3" "--field field7" "--field $CH" "--field mirror" \
            "--preset kit4_sixplus --field field5" "--preset kit4_sixplus --field $CH" \
            "--preset rehearsal_sixplus --field custom:planb_sd=7" "--preset kit4_sixplus --field field7"; do
  i=$((i+1)); echo -e "\n## ${cell:0:60}\n"
  python3 -m sng.arena $cell --candidates "$C" --baseline icm_tag --tables 300 --workers 3 --seed0 $((221000+1000*i)) 2>&1 | grep -A4 "paired"
done
echo done
} > results/logs/sng_smbrr_ab.tmp
mv results/logs/sng_smbrr_ab.tmp $OUT

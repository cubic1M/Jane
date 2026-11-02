#!/bin/bash
# All test suites in parallel (one process each); prints a pass/fail line per suite and
# exits non-zero if any fails. Logs: results/logs/test_<suite>.log
cd "$(dirname "$0")"
mkdir -p results/logs
T0=$(date +%s)
declare -A CMD=(
  [engine]="python3 -m unittest discover -s engine/tests -t ."
  [bots]="python3 -m unittest discover -s bots/tests -t ."
  [opponents]="python3 -m unittest opponents.test_opponents_claude opponents.test_opponents_lagexp opponents.test_opponents_tagteam"
  [tournament]="python3 -m unittest discover -s tournament -t . -p test*.py"
  [server]="bash -c 'cd rehearsal/server && python3 -m unittest discover -s tests'"
  [sng]="python3 -m unittest discover -s sng/tests -t ."
  [sng_field]="python3 -m unittest discover -s sng/field/tests -t ."
  [sng_ours]="python3 -m unittest discover -s sng/ours/tests -t ."
  [sng_field2]="python3 -m unittest discover -s sng/field2/tests -t ."
  [sng_field3]="python3 -m unittest discover -s sng/field3/tests -t ."
)
# phase 1: everything in parallel with timing assertions off (parallel load makes them noisy)
export SNG_SKIP_TIMING=1 FIELD_SKIP_TIMING=1
for s in "${!CMD[@]}"; do
  ( S=$(date +%s); eval "${CMD[$s]}" > results/logs/test_$s.log 2>&1; rc=$?
    echo "$rc $s $(( $(date +%s) - S ))s $(grep -E '^Ran ' results/logs/test_$s.log)" ) > results/logs/test_$s.rc &
done
wait
fail=0
for s in engine bots opponents tournament server sng sng_field sng_field2 sng_field3 sng_ours; do
  read rc name secs ran < results/logs/test_$s.rc
  if [ "$rc" = 0 ]; then st=OK; else st=FAIL; fail=1; fi
  printf "%-11s %-4s %6s  %s\n" "$name" "$st" "$secs" "$ran"
done
# phase 2: the timing tests alone, one suite at a time, on a quiet machine
unset SNG_SKIP_TIMING FIELD_SKIP_TIMING
TS=$(date +%s)
for t in sng.ours.tests.test_icm_tag.TestIcmTag.test_fast_including_first_decision \
         sng.ours.tests.test_anyvar.TestIcmAny.test_legal_and_fast_on_discard_variants \
         sng.field.tests.test_field.TestTiming \
         sng.field2.tests.test_field2.TestTables.test_timing_p99_under_0_4ms \
         sng.field2.tests.test_field2.TestColdStart.test_no_lazy_build_inside_act \
         sng.field3.tests.test_timing.TestTiming; do
  if python3 -m unittest "$t" > results/logs/test_timing.log 2>&1; then :; else
    echo "timing     FAIL  $t"; tail -3 results/logs/test_timing.log; fail=1; fi
done
echo "timing     done   $(( $(date +%s) - TS ))s (serial)"
echo "all suites: $(( $(date +%s) - T0 ))s wall"
exit $fail

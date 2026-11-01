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
)
for s in "${!CMD[@]}"; do
  ( S=$(date +%s); eval "${CMD[$s]}" > results/logs/test_$s.log 2>&1; rc=$?
    echo "$rc $s $(( $(date +%s) - S ))s $(grep -E '^Ran ' results/logs/test_$s.log)" ) > results/logs/test_$s.rc &
done
wait
fail=0
for s in engine bots opponents tournament server sng sng_field sng_ours; do
  read rc name secs ran < results/logs/test_$s.rc
  if [ "$rc" = 0 ]; then st=OK; else st=FAIL; fail=1; fi
  printf "%-11s %-4s %6s  %s\n" "$name" "$st" "$secs" "$ran"
done
echo "all suites: $(( $(date +%s) - T0 ))s wall"
exit $fail

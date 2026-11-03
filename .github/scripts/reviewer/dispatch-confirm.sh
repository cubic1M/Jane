#!/usr/bin/env bash
# Starts review-confirm.yml on the PR's branch if any finding has a test, waits, and collects the
# results. Anything going wrong here leaves the findings as notes: only a test can stop a merge.
#   dispatch-confirm.sh <artifacts dir> <out dir>
set -u
in=$1
out=$2
has_test=$(node -e '
  const { readdirSync, readFileSync, existsSync } = require("node:fs");
  const found = ["review-claude", "review-second"].some((dir) => {
    const path = `${process.argv[1]}/${dir}`;
    return existsSync(path) && readdirSync(path).some((f) =>
      JSON.parse(readFileSync(`${path}/${f}`, "utf8")).findings?.some((x) => x.test));
  });
  console.log(found ? "yes" : "no");
' "$in")
[ "$has_test" = yes ] || { echo "No finding has a test."; exit 0; }
read -r number sha < <(node -p 'const i = JSON.parse(require("node:fs").readFileSync(process.argv[1] + "/review-input/input.json", "utf8")); `${i.number} ${i.sha}`' "$in")
branch=$(cat "$in/review-input/branch.txt")
gh workflow run review-confirm.yml --ref "$branch" -f review_run="$REVIEW_RUN" -f number="$number" -f sha="$sha" ||
  { echo "Couldn't start it: does this branch have review-confirm.yml yet?"; exit 0; }
title="confirm $REVIEW_RUN"
id=""
for _ in $(seq 1 40); do
  sleep 30
  id=$(gh run list --workflow review-confirm.yml --branch "$branch" --event workflow_dispatch --limit 20 \
    --json databaseId,displayTitle,status \
    --jq "[.[] | select(.displayTitle == \"$title\" and .status == \"completed\")][0].databaseId // empty")
  [ -n "$id" ] && break
done
[ -n "$id" ] || { echo "It didn't finish in time."; exit 0; }
gh run download "$id" -n confirm-results -D "$out" || echo "It left no results."

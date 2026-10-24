"""A small merge queue for this repo, run by .github/workflows/merge-train.yml.

Main requires branches to be up to date, and user-owned repos can't use GitHub's merge
queue. Every run lands an auto-merge PR that passed and is up to date but whose auto-merge
never fired, then starts main's CI by hand (a merge made with the workflow token starts no
workflows). Usually GitHub's auto-merge does the merging itself.

Order: the PR numbers in the MERGE_PRIORITY repo variable (comma separated) first, then
the oldest. Drafts, PRs without auto-merge, PRs with conflicts and PRs whose required
checks failed on their current commit are skipped: they need a person (or a lane).
"""

import json
import os
import subprocess
import sys

# The checks main's ruleset requires. "End-to-end tests" passes when its shards did, or when
# a PR without the "e2e" label skipped them.
REQUIRED = ("Lint, typecheck and unit tests", "Secret scan", "End-to-end tests")
FAILED = {"FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"}
UP_TO_DATE = {"BLOCKED", "UNSTABLE", "CLEAN", "HAS_HOOKS"}


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def required_state(pr):
    """'none' when no required check exists yet, else 'failure', 'pending' or 'success'."""
    checks = {c.get("name") or c.get("context"): c for c in pr["statusCheckRollup"]}
    found = [checks[name] for name in REQUIRED if name in checks]
    if not found:
        return "none"
    if any((c.get("conclusion") or c.get("state")) in FAILED for c in found):
        return "failure"
    if len(found) < len(REQUIRED) or any(
        c.get("status", "COMPLETED") != "COMPLETED" for c in found
    ):
        return "pending"
    return "success"


def order(prs, priority):
    rank = {n: i for i, n in enumerate(priority)}
    return sorted(prs, key=lambda p: (rank.get(p["number"], len(rank)), p["number"]))


def main():
    priority = [int(n) for n in os.environ.get("PRIORITY", "").replace(" ", "").split(",") if n]
    prs = json.loads(
        gh(
            "pr", "list", "--base", "main", "--state", "open", "--limit", "100",
            "--json",
            "number,isDraft,mergeStateStatus,autoMergeRequest,statusCheckRollup,headRefName,headRefOid",
        )
    )
    queued = order([p for p in prs if p["autoMergeRequest"] and not p["isDraft"]], priority)

    in_flight = [
        p for p in queued
        if p["mergeStateStatus"] in UP_TO_DATE and required_state(p) != "failure"
    ]
    # Passed and mergeable, but GitHub's auto-merge sometimes never fires: land it here. A merge
    # made with the workflow token starts no workflows, so main's CI is started by hand.
    for p in in_flight:
        if p["mergeStateStatus"] in {"CLEAN", "HAS_HOOKS"} and required_state(p) == "success":
            try:
                gh("pr", "merge", str(p["number"]), "--squash")
            except subprocess.CalledProcessError as e:
                print(f"could not merge #{p['number']}: {e.stderr.strip()}")
                continue
            print(f"merged #{p['number']} (passed; auto-merge had not fired)")
            gh("workflow", "run", "ci.yml", "--ref", "main")
            return

    # It doesn't bring PRs up to date: a commit made with the workflow token counts as an
    # unattributed change, which main's ruleset holds for extra approval, so the PR would sit
    # BLOCKED with no checks. Branches are updated by a person's token (the lanes, or the
    # manager's script); this workflow only lands what has already passed.
    print("in flight:" if in_flight else "nothing ready to land", ", ".join(f"#{p['number']}" for p in in_flight))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(e.stderr, file=sys.stderr)
        raise

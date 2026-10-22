"""A small merge queue for this repo, run by .github/workflows/merge-train.yml.

Main requires branches to be up to date, and user-owned repos can't use GitHub's merge
queue. So every run: if an auto-merge PR is already up to date (testing, or passed and
about to merge), leave it be; otherwise bring the next auto-merge PR that is BEHIND up to
date and start CI on it. Pushes made with the workflow token start no workflows, which is
why CI is dispatched by hand. GitHub's auto-merge does the merging itself.

Order: the PR numbers in the MERGE_PRIORITY repo variable (comma separated) first, then
the oldest. Drafts, PRs without auto-merge, PRs with conflicts and PRs whose required
checks failed on their current commit are skipped: they need a person (or a lane).
"""

import json
import os
import subprocess
import sys

REQUIRED = ("Lint, typecheck and unit tests", "Secret scan")
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


def dispatch_ci(pr):
    gh("workflow", "run", "ci.yml", "--ref", pr["headRefName"])
    print(f"started CI on #{pr['number']} ({pr['headRefName']})")


def main():
    priority = [int(n) for n in os.environ.get("PRIORITY", "").replace(" ", "").split(",") if n]
    prs = json.loads(
        gh(
            "pr", "list", "--base", "main", "--state", "open", "--limit", "100",
            "--json", "number,isDraft,mergeStateStatus,autoMergeRequest,statusCheckRollup,headRefName",
        )
    )
    queued = order([p for p in prs if p["autoMergeRequest"] and not p["isDraft"]], priority)

    in_flight = [
        p for p in queued
        if p["mergeStateStatus"] in UP_TO_DATE and required_state(p) != "failure"
    ]
    if in_flight:
        for p in in_flight:
            # Brought up to date by an earlier run whose CI never started: start it now.
            if required_state(p) == "none":
                dispatch_ci(p)
        print("in flight:", ", ".join(f"#{p['number']}" for p in in_flight))
        return

    behind = [
        p for p in queued
        if p["mergeStateStatus"] == "BEHIND" and required_state(p) != "failure"
    ]
    if not behind:
        print("nothing to update")
        return
    pr = behind[0]
    repo = os.environ["GH_REPO"]
    gh("api", "-X", "PUT", f"repos/{repo}/pulls/{pr['number']}/update-branch")
    print(f"updated #{pr['number']}")
    dispatch_ci(pr)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(e.stderr, file=sys.stderr)
        raise

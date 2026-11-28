# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-28T08:23Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 25 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 221 min | 0 min |
| 2 | Red main | Is delivery blocked? | 86 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 66 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 66 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 4.1% (of 66 merged) | 10.6% |
| 7 | Proof-of-fix rate | Are fixes real? | 22.2% | 95.5% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 12 | 6 |
| 9a | Merged with no founder approval | How autonomous? | 66 | 39 |
| 9b | Closed unmerged | How much waste? | 3 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 1531580 | 122047 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib/connectors | 8366 | 1.6% |
| lib | 3123 | 2.4% |
| config | 2622 | 3.7% |
| planning | 1419 | 1.4% |
| lib/agent | 1127 | 10.3% |
| lib/jane-agent | 936 | 4.2% |
| app | 886 | 4.3% |
| detectors | 528 | 11% |
| data-sources | 270 | 6.7% |
| .github | 225 | 16.9% |
| lib/insurance | 198 | 1% |
| root | 188 | 16% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| not recorded | 63 |
| claude-sonnet-5-5 / 2.1.331 | 3 |

## Holdout scenarios

Last run 2026-11-27T15:36Z on `dab70fc0`: 8 of 18 passed.

## Daily canary task

No run recorded yet.

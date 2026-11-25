# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-25T09:04Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 22 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 19 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 19 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 6.4% (of 19 merged) | 13.1% |
| 7 | Proof-of-fix rate | Are fixes real? | 80% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 9 | 6 |
| 9a | Merged with no founder approval | How autonomous? | 19 | 45 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 122047 | 111744 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 7703 | 6% |
| lib/jane-agent | 5295 | 3.8% |
| scripts | 2717 | 1.7% |
| config | 2656 | 18.9% |
| security | 2585 | 0.7% |
| data-sources | 1970 | 1.6% |
| .github | 1880 | 8.9% |
| app | 1728 | 8.2% |
| gates | 1374 | 3.9% |
| detection | 1079 | 0.7% |
| lib/import | 940 | 0.7% |
| .claude | 742 | 0% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-sonnet-5-5 / 2.1.330 | 12 |
| not recorded | 5 |
| claude-opus-5-5 / 2.1.330 | 2 |

## Holdout scenarios

Last run 2026-11-24T16:18Z on `0d7a3426`: 11 of 18 passed.

## Daily canary task

No run recorded yet.

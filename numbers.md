# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-14T06:58Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 11 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 326 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 45 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 45 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 8.5% (of 45 merged) | 13.1% |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 4 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 45 | 32 |
| 9b | Closed unmerged | How much waste? | 0 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 26105 | 64543 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib/market | 5694 | 0.2% |
| planning | 4505 | 4.2% |
| lib/jane-agent | 3656 | 11.2% |
| lib | 3316 | 10.4% |
| components | 2147 | 25.3% |
| lib/insurance | 1999 | 5.5% |
| lib/practice | 1525 | 5.9% |
| app | 1366 | 20.1% |
| lib/investments | 1194 | 1.5% |
| config | 1184 | 7% |
| detectors | 1124 | 13.4% |
| lib/hub | 1085 | 12.1% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 24 |
| not recorded | 14 |
| unknown / unknown | 7 |

## Holdout scenarios

Last run 2026-11-13T13:29Z on `e6748451`: 11 of 18 passed.

## Daily canary task

No run recorded yet.

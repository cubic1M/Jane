# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-16T07:13Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 13 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 0 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 61 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 61 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 17.4% (of 61 merged) | 13.5% |
| 7 | Proof-of-fix rate | Are fixes real? | 100% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 6 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 61 | 45 |
| 9b | Closed unmerged | How much waste? | 2 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 8182 | 26105 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 3235 | 22.8% |
| components | 3210 | 15.2% |
| app | 2032 | 27.4% |
| e2e | 1623 | 14.6% |
| lib/jane-agent | 1086 | 8.4% |
| planning | 655 | 0.8% |
| lib/hub | 567 | 5.8% |
| insights | 476 | 3.2% |
| config | 250 | 21.6% |
| lib/investments | 163 | 9.2% |
| lib/insurance | 152 | 2% |
| scripts | 145 | 65.5% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 49 |
| unknown / unknown | 12 |

## Holdout scenarios

Last run 2026-11-15T13:02Z on `f71fb413`: 11 of 18 passed.

## Daily canary task

No run recorded yet.

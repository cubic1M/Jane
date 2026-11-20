# Is autonomy holding?

Written by `scripts/ops/numbers.mjs` at 2026-11-20T07:43Z. No model is involved.

**Baselining until 2026-12-01. There are no thresholds yet:** nobody publishes these numbers for unattended agents, so any target today would be invented. 17 of 28 days recorded.

| # | Number | Answers | Last day | 28-day median |
| --- | --- | --- | --- | --- |
| 1 | Deploy lag | Is the pipeline alive? | 0 min | 0 min |
| 2 | Red main | Is delivery blocked? | 79 min | 0 min |
| 3 | Rolled back or reverted | Did releases hold? | 0 (of 61 merged) | 0 |
| 4 | Bad deploy to last-good | How fast is recovery? | no data | no data |
| 5 | Escaped bugs per 100 PRs | Is the gate leaking? | 0 (of 61 merged) | 0 |
| 6 | Lines changed again in 21 days | Does the work last? | 7.6% (of 61 merged) | 13.9% |
| 7 | Proof-of-fix rate | Are fixes real? | 66.7% | 100% |
| 8 | Tasks silent for 2 hours | Is anything stuck? | 8 | 4 |
| 9a | Merged with no founder approval | How autonomous? | 61 | 58 |
| 9b | Closed unmerged | How much waste? | 1 | 0 |
| 10 | Tokens per merged PR | Is it affordable? | 305100 | 86106 |
| 11 | Planted bugs caught | Is review worth it? | no data | no data |

Number 5 counts only bugs someone or something finds, so it will read low at first. Number 6 is one day's commits from 21 days ago. Number 7 counts unmarked fixes by their words, so it can only overstate. Number 10 counts only PRs that carry an `Agent:` line.

## Number 6 by area

| Area | Lines added | Changed again |
| --- | --- | --- |
| lib | 2487 | 3.1% |
| app | 1981 | 13.4% |
| lib/memory | 1790 | 0.9% |
| lib/jane-agent | 1214 | 7.7% |
| lib/digest | 880 | 9.8% |
| e2e | 714 | 7.6% |
| detection | 711 | 10.7% |
| planning | 555 | 7.9% |
| components | 294 | 18% |
| insights | 241 | 4.6% |
| config | 195 | 27.7% |
| categorize | 129 | 2.3% |

## Who did the work

| Model / Claude Code | Merged PRs |
| --- | --- |
| claude-opus-5-5 / 2.1.309 | 60 |
| unknown / unknown | 1 |

## Holdout scenarios

Last run 2026-11-19T14:46Z on `9a80db7f`: 9 of 18 passed.

## Daily canary task

No run recorded yet.

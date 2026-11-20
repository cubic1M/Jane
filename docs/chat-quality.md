# Chat quality

How well Jane's chat understands and answers, measured on one question bank
(`src/lib/jane-agent/checks/bank.ts` and `bank-more.ts`, spec steps 87 and 189). Every change to
the chat is measured against the numbers here. Scores are only meant to go up.

## The bank

- About 500 questions in all (about 470 different wordings), worded the way people talk: short forms,
  typos, follow-ups that need the one before, two questions in one message.
- Every sector and every page of the app has questions. Each new question names its sector,
  its page, the Claude tool it should reach and the guardrail profile its answer is checked with
  (`demo_advice` for insurance, taxes, investing, HSA, giving, loans, student loans and credit).
- It includes every question the QA report found unanswered: "what's my net worth", "why is my
  checking going negative", "what about my HSA", "move $200 to savings".
- `src/lib/jane-agent/checks/bank.test.ts` keeps it honest: at least 400 questions, each tool
  named exists, every page and sector covered.

## How it's scored

| Command | What it does | Needs |
| --- | --- | --- |
| `npm run checks:baseline` | How many first questions the rules alone understand (an answer of their own, not the generic fallback), by sector and page. Takes about two minutes. | A scratch database in `TEST_DATABASE_URL`; no key |
| `npm run checks:answers` | Asks the bank as the person would and grades each answer: fixed checks (the answer first, the right figures, tone, guardrails, length), then Claude against a rubric. | The same; the Claude part also needs `ANTHROPIC_API_KEY` |

Claude answers all typed text, so a score from the rules part says little about what people read:
it covers the backup, which they see only when Claude can't answer. `real_path` is the free nightly
score that covers the real path: every question goes through the real chat (primer, tool routing,
tools, guardrails, streaming) with only the model played back
(`src/lib/jane-agent/checks/real-path.ts`). It shows whether the path works, not whether an answer
is good: that takes the paid part. A slice runs on every pull request.

One first question in ten also goes through the rounds where Claude doesn't answer at first: it
refuses, writes something the guardrails block (each draft trips one rule), or switches model
mid-answer. The person must get Claude's own words with nothing blocked or refused left on screen,
and when Claude refuses or is blocked every time, the backup answers. The pull request slice runs
these on the demo bank and on a real account, and checks that someone who was wronged is never
refused while someone asking to do wrong always is.

Recorded answers are graded by code first and for free: `src/lib/jane-agent/checks/regrade.ts` runs
the guardrails and graders over the 124 real answers of the 10-21 run on every pull request, and the
guardrails are scored both ways in `src/lib/guardrails.scored.test.ts`.

Without a key the Claude questions are skipped and the run says so. Time to first words is
recorded for every answered question.

## The depth bar

The nightly run (`.github/workflows/chat-quality.yml`, the only place the key is used) records
three measures and two timings, in the Nightly table below:

- **Understood**: the share of questions Jane answered (an answer of its own, not the "I couldn't
  look into that" or "I can't answer that one yet" fallback, and not blocked). Bar: 95%.
- **Figures right**: of the questions that must show the person's figures, the share that show
  every one. Bar: 100%.
- **Follow-ups**: of the follow-ups (a question that needs the one before) and two-questions-in-one,
  the share scoring at least 80. Bar: 90%.
- **First words** and **Full answer**: the median seconds until the first words and until the
  whole answer (the same for a rules answer, which arrives at once).

The bar is met on a night when all three hold; the doc says when it was met three nights in a row.
Claude's grade is by Claude Haiku (`GRADER_MODEL` in `src/config/answer-checks.ts`) against a rubric
(`grader-v2`), so grading fits the budget: about $5 a month of the $10 account
(`CHAT_NIGHTLY_CAP_CENTS`, 15 cents a night); the chat itself stays on its own model. The nightly
rotates through the Claude questions, so the whole bank is covered over a few weeks, and the rules
questions run every night.

## Baseline (rules only, no key)

Recorded with `npm run checks:baseline` on the demo bank, before any of Phase AI's changes. "Understood" means the
rules gave an answer of their own; it does not mean the route or the figures were right, which
only the graded run measures.

Rules understood 334 of 491 first questions (68%).

| Sector | Asked | Rules understood |
| --- | ---: | ---: |
| actions | 3 | 33% |
| afford | 11 | 100% |
| ask | 1 | 0% |
| bills | 28 | 43% |
| budgets | 9 | 22% |
| cmd | 10 | 100% |
| connect | 1 | 0% |
| cost | 7 | 100% |
| credit | 5 | 60% |
| debt | 27 | 70% |
| edge | 13 | 15% |
| flow | 2 | 100% |
| follow | 7 | 71% |
| free | 16 | 25% |
| giving | 3 | 100% |
| goals | 11 | 27% |
| help | 9 | 33% |
| household | 3 | 0% |
| hsa | 4 | 75% |
| income | 9 | 89% |
| insurance | 36 | 97% |
| investing | 38 | 95% |
| life | 14 | 43% |
| loans | 11 | 73% |
| moving | 10 | 60% |
| multi | 2 | 100% |
| networth | 11 | 18% |
| report | 2 | 0% |
| safe | 28 | 75% |
| settings | 9 | 78% |
| spending | 26 | 54% |
| spent | 11 | 100% |
| student | 6 | 50% |
| subs | 38 | 79% |
| taxes | 40 | 80% |
| tell | 2 | 100% |
| timeline | 2 | 100% |
| two | 8 | 75% |
| typos | 10 | 60% |
| whole | 8 | 88% |

| Page | Asked | Rules understood |
| --- | ---: | ---: |
| /actions | 3 | 33% |
| /afford | 4 | 100% |
| /ahead | 1 | 0% |
| /alerts | 6 | 0% |
| /ask | 1 | 0% |
| /bills | 15 | 40% |
| /budgets | 9 | 22% |
| /chat | 188 | 84% |
| /check-in | 2 | 0% |
| /connect | 2 | 0% |
| /deadlines | 3 | 67% |
| /debt | 14 | 43% |
| /documents | 2 | 50% |
| /goals | 13 | 23% |
| /home | 24 | 63% |
| /household | 3 | 0% |
| /import | 1 | 0% |
| /insights | 2 | 50% |
| /insurance | 22 | 95% |
| /investments | 22 | 95% |
| /investments/hsa | 4 | 75% |
| /jane | 3 | 100% |
| /learn | 3 | 67% |
| /life-events | 6 | 67% |
| /loans | 11 | 73% |
| /loans/credit | 5 | 60% |
| /loans/student | 6 | 50% |
| /money | 1 | 0% |
| /net-worth | 12 | 25% |
| /plan | 3 | 33% |
| /report | 2 | 0% |
| /saved | 3 | 33% |
| /settings | 6 | 67% |
| /subscriptions | 27 | 67% |
| /tax-pack | 2 | 100% |
| /taxes | 23 | 65% |
| /taxes/giving | 3 | 100% |
| /things | 2 | 50% |
| /transactions | 19 | 63% |
| /transfers | 10 | 60% |
| /year | 3 | 33% |

Rules-only answer checks: score 100 over 151 graded questions (348 skipped, because they need
Claude). This is the floor CI holds (`RULES_SCORE_FLOOR`).

The Claude part has not been measured yet: there was no `ANTHROPIC_API_KEY` where this was
recorded. The first run with a key replaces this paragraph with its scores (understood rate,
right figures, guardrails, time to first words, and the cost of the run).

## What grading costs

The founder pays for every graded question, from one shared monthly Anthropic limit (the live
chat and this grading together), so the nightly run is small by design:

- The rules questions run every night: free.
- The Claude questions rotate: each night asks `CHAT_NIGHTLY_COUNT` (20) conversations from the
  bank, moving along it, so the whole bank is covered over a few weeks.
- A night stops asking at `CHAT_NIGHTLY_CAP_CENTS` (15 cents), priced at the model's listed
  price (`MODEL_PRICES_CENTS`), so a month costs at most 30 x 15 cents = $4.50.
- The first night with the key records what it really spent in the table below; this paragraph
  is updated with the measured cost per question and how many nights a full pass takes.

## Nightly

Written by the nightly run (.github/workflows/chat-quality.yml).

<!-- nightly:start -->
| Night | Mode | Score | Graded | Skipped | Failing | First words (median) | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-10-20 | rules only | 100 | 158 | 22 | 0 | 15 ms | $0.00 |
<!-- nightly:end -->

## Scenario run

Written by the overnight scenario run (.github/workflows/chat-eval.yml, `npm run checks:eval`).

<!-- eval:start -->
Last batch on 2026-11-20: 20 scenarios finished so far, 20 messages graded, 8 failing (under 80), 0 skipped. Cost so far $5.10; a batch is capped at $0.55.

| Category | Graded | Failing | Pass rate | Skipped | Average |
| --- | ---: | ---: | ---: | ---: | ---: |
| walk: phone S5 | 3 | 2 | 33.3% | 0 | 73 |
| walk: desktop S5 | 1 | 1 | 0% | 0 | 70 |
| walk: desktop S6 | 2 | 1 | 50% | 0 | 75 |
| walk: desktop S7 | 1 | 1 | 0% | 0 | 70 |
| walk: phone S1 | 2 | 1 | 50% | 0 | 75 |
| walk: phone S3 | 2 | 1 | 50% | 0 | 78 |
| walk: phone S6 | 2 | 1 | 50% | 0 | 78 |
| walk: desktop S3 | 1 | 0 | 100% | 0 | 80 |
| walk: desktop S4 | 2 | 0 | 100% | 0 | 80 |
| walk: phone S2 | 2 | 0 | 100% | 0 | 88 |
| walk: phone S4 | 1 | 0 | 100% | 0 | 80 |
| walk: phone S7 | 1 | 0 | 100% | 0 | 90 |

**The 20 worst answers**

- walk3-s6p-2 (65, walk: phone S6): "How much do I put into savings each month?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: Does not say $200.00 a month by transfer to Ally Bank savings; Implies they put nothing into savings. The answer says no trans Answer began: "I can't see any transfers into savings in your accounts over the last six months, and you have no savings goals set up. What you do keep is about $1,851.19 a month after spending, which is 38% of the $4,900.00 you take home. A common target is 20%, or $980.00 a month, so you're above it. That money"
- walk3-s5p-3 (70, walk: phone S5): "How much do I spend on Starbucks?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: Frames total as this year, not the month of statements; Omits the about $20 a month figure. The total of $20.20 across the thr Answer began: "You've spent $20.20 at Starbucks this year, across 3 visits. The most recent was $6.10 on Nov 13. The other two were $7.25 on Oct 30 and $6.85 on Oct 18. All three visits fall within the last two months. I don't see any earlier Starbucks charges in your accounts this year."
- walk3-s5p-1 (70, walk: phone S5): "How much do I make a year?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: does not say the figure is an estimate from one month of statements. The answer gives the right take-home figure with the pers Answer began: "You make about $16,119.96 a year before anything is taken out. That's $620.00 every two weeks from University of California payroll, or $1,343.33 a month. I counted 26 paychecks a year, and I can't see what's withheld from them. If you get other income that doesn't come through that payroll, it isn'"
- walk3-s5d-1 (70, walk: desktop S5): "How much do I make a month?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: Does not say the estimate is from only one month of data. It answers the question in the first sentence using the Campus Dinin Answer began: "You make about $1,543.75 a month. That counts your pay by its schedule: $712.50 every two weeks from Campus Dining, 26 paychecks a year. October's actual deposits came to $1,422.30, because it held two paychecks. November so far is $721.10, and the next payday should bring more."
- walk3-s6d-1 (70, walk: desktop S6): "What is my income?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: Omits the $598.70 to $655.20 paycheck range; Omits the $638.10 Nov 13 paycheck. It answers the income question up front with t Answer began: "Your income is about $1,354.71 a month. It comes from UNIV OF CALIF payroll, at $625.25 every two weeks (26 paychecks a year). October's deposits were bigger, at $2,280.00. That included a $400.00 Zelle transfer and three paychecks, which is why it was above your usual month. So far in November, $1,"
- walk3-s7d-1 (70, walk: desktop S7): "Can I get my bank fee waived?" — 723 characters, over 700. Claude: Broke: Does not state Bank of America's own waiver terms (such as the $250 qualifying direct deposit) attributed to the bank. It names the $12.00 monthly fee and the Answer began: "Maybe. Your Bank of America checking charges a $12.00 monthly fee, which is $144.00 a year. I can't contact the bank for you. Your $3,000.00 in pay was deposited there the month before the last fee, so it could qualify. Your account may be a different type, or the deposit may not count, and only the"
- walk3-s1p-2 (70, walk: phone S1): "How much do I send on Venmo?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: Does not say $40.00 a month by Venmo. It gives the right total and the two $40.00 transfers with dates, but it never states th Answer began: "I can see $80.00 going out to Venmo since January 1, in two transfers of $40.00, on Oct 18 and Sep 18. Your accounts list both as "Transfers out", so I can't confirm they were Venmo payments. Nothing has gone out in November so far, and no money has come in. Venmo payments made through a card or ano"
- walk3-s3p-2 (70, walk: phone S3): "How much money will I have at the end of the month?" — The guardrails would refuse it: unsupported_dollar_figure. Claude: Broke: Does not address the Nov 15 paycheck. The first sentence gives a clear Nov 30 figure from the person's balance, bills and payc Answer began: "You'll have about $5,396.46 in checking on Nov 30, if you spend nothing else. That starts from your estimated balance today of $3,878.56. It takes off the $62.10 Austin Energy bill on Nov 21 and adds your $1,580.00 Brightwave Media paycheck on Nov 30. Rent of $1,150.00 comes out on Dec 1, so it isn'"
<!-- eval:end -->

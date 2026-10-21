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

Without a key the Claude questions are skipped and the run says so. Time to first words is
recorded for every answered question.

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

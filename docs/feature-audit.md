# Feature audit: what overlaps, and how we merge it

Written 2026-10-22 for the founder. Jane was built in about 290 roadmap steps by many
sessions working side by side. Several steps ended up doing the same job in two or three
places: the person gets two emails about the same month, or two messages about the same
week, and every copy has its own code and tests to keep working. This audit lists those
overlaps and how each one gets merged.

The rules for every merge:

- **No sector is dropped and no outcome is lost.** If a person can do or see something
  today, they still can after the merge, in one place instead of two.
- **Only code that is fully replaced is removed.** Where a merge would take away something a
  person could still miss, it stays, and this audit says so.
- **Tests move to the surviving code**, so coverage doesn't drop.
- **Analytics and audit events follow the surviving path**, and each removed event is named.
- Each merge is its own small pull request titled "Merge: <cluster>", done in the order
  2, 3, 4, 5, 1, 8. Clusters 6 and 7 are only noted here: other sessions are working on
  that code tonight.

How to read the tables: "Today" is what the step does in the app right now, with where it
lives in the code. "Seen twice" is what the person actually notices. "Risk" is what could
go wrong with the merge: low means nothing visible changes except the duplicate going away.

---

## Cluster 2: summary messages and emails

**Target:** one daily brief in the chat, one weekly email, one monthly report (in the chat
and by email). The year in review becomes part of December's report.

| Step | Today | Where |
| --- | --- | --- |
| 9 Weekly digest | Weekly email: saved this week, what's pending, new findings. Sent by the daily cron when the person's Monday arrives. | `src/lib/digest/*`, `/api/cron/digest`, events `digest_sent`, `digest_clicked` |
| 39 Weekly plan email | Budgets, goals and net worth sections added *inside* the same digest email. | `src/lib/digest/build.ts` (`DigestPlans`) |
| 35 Year in review | The `/year` page: a year's spending, findings and savings, printable. Not emailed, not in the chat. | `src/lib/year.ts`, `src/app/year` |
| 38 Money calendar feed | A private calendar link (iCalendar) with expected bills, deposits and goal dates. | `src/lib/calendar.ts`, `/api/calendar/[token]` |
| 45 Monthly check-in | The `/check-in` page for last month (spent, came in, net worth, budgets, goals, a short summary written by Claude), **and an email in the first week of the month**. | `src/lib/check-in.ts`, `src/lib/check-in-email.ts`, event `check_in_emailed` |
| 96 The week in the chat | A Monday chat message: "the week of Oct 13, we covered 4 questions, 2 decisions…". | `sources/week.ts` |
| 101 Weekly review | A Sunday-evening chat message: what Jane did, what it saved, what's next week, one decision. | `sources/review.ts`, `replies-review.ts` |
| 148 Monthly report | Saved, earned, paid down, moved, health score change, receipts. Posted in the chat **and emailed in the first week of the month**, kept at `/monthly`. | `src/lib/monthly-report.ts`, `sources/report.ts`, event `monthly_report_emailed` |
| 184 The day in one message | The morning brief turned into the day's agenda: overnight checks, what needs a yes, what's coming up. Already the one daily message. | `agenda.ts`, `brain.ts`, `sources/brief.ts` |

**What the person sees twice today**

- **Two emails about last month.** In the first week of every month the same person gets the
  check-in email *and* the monthly report email, both about the month that just ended, both
  with "spent / came in" style figures. Two pages show last month too: `/check-in` and
  `/monthly`.
- **Three weekly summaries.** The weekly email (Monday), the "we covered" chat message
  (Monday) and the weekly review chat message (Sunday) all say what happened this week.
- **The year in review is hidden.** It's only on `/year` and the Ahead hub; nothing ever
  brings it to the person.

**Merge plan** (PR "Merge: summaries")

1. **One monthly report.** The report gains the check-in's pieces it lacked: spending
   against the month before, budgets kept, goals moved, net worth change, and the short
   written summary (still Claude through the guardrails with the fixed-wording fallback).
   The check-in email stops; the monthly report email is the one email. `/check-in`
   redirects to `/monthly` (with the month), and `/monthly` shows the check-in's numbers.
   Removed: `src/lib/check-in-email.ts` and its call in the cron. Kept: `src/lib/check-in.ts`
   (the report reads it). Event `check_in_emailed` is retired; `monthly_report_emailed`
   carries on.
2. **Year in review in December's report.** The report for December (made in early January)
   adds a "Your year" section: the year's spending, what Jane found and what was saved, from
   the same loader as `/year`, with a link to the printable page. `/year` stays: it is the
   printable keepsake and the place to look at any past year.
3. **One daily message in the chat.** The weekly review and the "we covered" message stop
   being separate messages. On the first day of the person's week, the morning brief carries
   a short "Last week" block (what Jane finished, what was confirmed saved, what you asked
   and decided). The review's "one decision" was already in the agenda's yes list.
4. **The weekly email stays as is** (steps 9 and 39 are already one email).
5. **The calendar feed stays.** It's not a summary, it's the person's own calendar; cluster 3
   makes it read from the same upcoming list as everything else.

**What users will notice:** one email per month instead of two; the weekly review moves from
Sunday evening into Monday morning's brief; December's report includes the year.

**Risk:** low to medium. The check-in email had a written summary the report email lacked; it
moves into the report so nothing is lost. People who opened `/check-in` from an old email
land on the same month's report. Page changes, so the PR runs end-to-end tests.

---

## Cluster 3: bills and deadlines

**Target:** one upcoming-bills-and-deadlines source that every screen, message and feed reads.

| Step | Today | Where |
| --- | --- | --- |
| 16 Upcoming bills and forecast | Expected date and amount of every regular bill; 30-day balance forecast; `/bills`; the `low_balance_risk` finding. | `src/detection/forecast.ts` (`upcomingBills`), `src/app/bills` |
| 32 Bill reminders | A "bill due soon" alert a few days before each bill, urgent when the balance may be short. | `src/detection/alerts.ts` (`billReminderAlerts`) |
| 71 Deadlines | Return windows, warranties, trials, renewals, card due dates, enrollment dates and the person's own dates on `/deadlines`, with `deadline_soon` reminders. | `src/lib/deadlines.ts`, `src/insights/deadlines.ts`, `src/app/deadlines` |
| 145 Bills paid on time | Card and loan payments scheduled before their due dates through the money stand-in. | `src/lib/money-movement/bill-pay.ts` |
| 79 "Coming up" | Already merges bills and deadlines into one list for Today, the brief and the chat. | `src/insights/coming-up.ts`, `src/lib/home.ts` |

**Already merged:** reminders don't double up (deadline reminders skip renewals and payments
that bill reminders cover, `DEADLINE_KINDS_REMINDED_ELSEWHERE`), and Today, the brief and the
chat's "coming up" tool use the one `comingUp` list.

**Still separate**

- **The calendar feed only knows bills, deposits and goals.** A return window, a warranty
  end, a renewal from an uploaded policy or an open-enrollment date is on `/deadlines` and in
  the brief, but never in the person's calendar. Step 38 asked for renewals in the feed.
- **Every reader builds its own list.** Today (`home.ts`), the Ahead hub, the calendar, the
  year plan and the chat each call the bills forecast and the deadline list themselves.

**Merge plan** (PR "Merge: bills and deadlines")

1. One loader, `src/lib/coming-up.ts` (`loadComingUp`), returns bills (forecast), deadlines
   (all deadline sources) and deposits as one dated list, with the same "a bill that is also
   a deadline shows once" rule Today already uses.
2. The calendar feed reads it, so deadlines appear in the person's calendar with stable ids.
3. `/bills` (the forecast and balance chart) and `/deadlines` (adding and ticking off your own
   dates) stay as the two detail pages: each does something the other can't.
4. Bill pay (145) keeps reading the bank's own due dates; that's the source of truth for
   payments and it already feeds the deadline list.

**What users will notice:** return windows, warranties, renewals and enrollment dates now
show in their calendar app alongside bills.

**Risk:** low. The feed only gains events; old events keep their ids.

---

## Cluster 4: merchant directory and support contacts

**Target:** one way to ask "what do we know about this company?"

| Step | Today | Where |
| --- | --- | --- |
| 24 Merchant directory | The `merchants` table (cancel link, support email and phone, aliases, category), edited at `/admin/merchants`. | `src/lib/merchants.ts`, `src/data-sources/merchant-directory.ts` |
| 40 Smarter directory | How cancellations and refunds usually go at each company ("usually about 10 minutes"), shown once there are enough cases. | `src/lib/merchant-outcomes.ts` |
| 64 Support contacts | When a support email is missing, Claude looks it up on the company's own site; the team confirms it. | `src/lib/agent/find-contact.ts` |

**What's duplicated:** not something people see twice, but the same lookup is written five
times. The action agent (three places), phone calls, the finding page and the team's action
page each normalise the company name, load the whole directory, match it, and separately load
how actions there usually go. The finding page and the team's page each do both lookups.

**Merge plan** (PR "Merge: merchant directory")

1. One function, `companyFacts(name)` in `src/lib/merchants.ts`: the directory row (with only
   a confirmed support email), plus how each kind of action usually goes there.
2. The agent, calls, the finding page and the admin action page use it. The step 64 lookup
   stays as is: it's the only way a missing address gets found.

**What users will notice:** nothing. **Risk:** low.

---

## Cluster 5: the rules-based chat

Claude answers everything typed (the "Chat architecture" section of the spec, 2026-10-21).
The rules (intents, replies, the question bank, "the right button") are now for button taps,
the answer typed to a guided flow's question, and the backup when Claude is down, capped or
there's no key (dev and tests).

| Step | Today | Where |
| --- | --- | --- |
| 23 Ask Jane | A **second chat** at `/ask`, with its own Claude tools, its own conversations table and its own API. Reachable only from a link under the chat for people who used it before. | `src/app/ask`, `src/lib/ask/*`, `/api/ask` |
| 84, 88, 90, 189–193 | Intents, replies, the capability registry, two-part questions, pronoun follow-ups, the right buttons. | `src/lib/jane-agent/intents.ts`, `replies*.ts`, `capabilities/*`, `answer.ts`, `typing.ts` |
| 87, 189, 195 | The question bank and the graders; the nightly run grades **Claude's** answers with it. | `src/lib/jane-agent/checks/*` |

**What's duplicated**

- **Two chats with two sets of Claude tools.** `/ask` (step 23) answers with its own eight
  tools (`src/lib/ask/tools.ts`) that overlap the chat's ~125 tools, and its Claude spend is
  **not** counted against the chat's monthly $8 guard (`CHAT_MONTHLY_CAP_CENTS`), only
  against an hourly rate limit. Anyone with an old Ask conversation can still type new
  questions there.

**What stays, and why**

- **The intents and replies stay.** They are the backup the spec requires: when Claude fails,
  is capped or is blocked by the guardrails, the person gets the rules' answer from the same
  data, never "unavailable". Dev and every test run without a key, so they also keep the
  whole test suite working. A scan of the code found no rules module that nothing uses.
- **The question bank stays.** It now grades Claude's answers every night (step 195).
- **The right-button logic stays.** Buttons only ever come after a written answer, and taps
  still go through the rules.

**Merge plan** (PR "Merge: rules-based chat")

1. `/ask` becomes a read-only archive of the person's earlier Ask Jane conversations: they can
   read and delete them, and a "Ask in the chat" link takes new questions to the one chat.
2. Removed: the second Claude path (`src/lib/ask/answer.ts`, `src/lib/ask/tools.ts`,
   `/api/ask`, the `AskChat` client). Kept: the conversations (in Download my data and
   deleted with the account), and the `ask` config the chat's guardrails still use.

**What users will notice:** the old Ask Jane page no longer takes new questions; it points to
the chat. **Risk:** low. Nobody new reaches `/ask`; the conversations stay readable.

---

## Cluster 1: per-sector "on autopilot" steps

**Target:** one autopilot (step 141's per-sector levels and caps) that every sector reads and
every page and answer describes.

| Step | Today | Where |
| --- | --- | --- |
| 57 Autopilot levels | Three levels (Ask me first, Handle the safe stuff, Handle everything allowed) and the standing rules they set; the chooser on Home and the plan. | `src/lib/autopilot.ts`, `src/config/autopilot.ts` |
| 141 One autopilot, every sector | A level and two dollar caps per sector (bills, insurance, debt, taxes, investing, goals); `mayAct` / `recordAct`; Settings and the chat change them. | `src/lib/sector-autopilot.ts`, `src/config/autopilot-sectors.ts` |
| 108 Insurance on autopilot | What Jane does with insurance at each **step 57** level (`INSURANCE_AUTOPILOT`), on `/insurance` and in the chat; quotes refreshed only at global "everything". The switch itself (141) obeys the **insurance sector**. | `config/insurance.ts`, `jane-agent/insurance/autopilot.ts`, `insurance/shop.ts`, `insurance/autopilot.ts` |
| 117 Debt on autopilot | Rate watching, due-date moves, payoff plan kept current, described per **debt sector** level (`DEBT_AUTOPILOT`). | `src/lib/debt-autopilot.ts`, `config/debt.ts` |
| 127 Taxes on autopilot | Tags, estimates, set-aside goal, return started; described per **step 57** level (`TAX_AUTOPILOT`, `whatJaneDoes`); "use what I found" also reads the step 57 level. | `src/lib/tax-autopilot.ts`, `config/tax.ts`, `tax-profile.ts`, `tax-states.ts` |
| 137 Investments on autopilot | Described per **step 57** level (`INVESTMENT_AUTOPILOT`) on `/investments` and in the chat. Automatic investing (164) obeys the **investing sector**. | `config/investing.ts`, `investments/automatic.ts` |
| 216, 223, 230 Round two | One yearly review per sector (investing, the tax calendar, debt), each listing what Jane did within the caps and what needs a tap. | `planning/yearly-review.ts`, `tax-calendar.ts`, `debt-review.ts` |
| 202 Insurance, round two | Not built yet (Phase AJ is parked); its spec already says to use the insurance sector's caps. | `docs/detectors/insurance.md` AJ7 |
| 273 Taxes, round three | The tax calendar ranked with the rest of the scan. | `tax-calendar.ts` |

**What the person sees that doesn't match**

- **Two answers to "what does Jane do by herself?"** Set Insurance to "Everything allowed" in
  Settings and Jane really does switch a policy by herself within the caps; but `/insurance`
  and the chat still read the step 57 level and say "I never buy, change or cancel cover
  without your tap". The same split exists for investing and taxes. Debt already reads its
  sector, and is the model.
- **Taxes use the wrong dial.** Whether Jane uses tax facts she found before you confirm them
  follows the overall level, not the Taxes setting, so turning Taxes to "Always ask" doesn't
  change it.

**Merge plan** (PR "Merge: autopilot")

1. One description per sector, keyed by the sector's own level (Always ask / The safe stuff /
   Everything allowed), in `src/config/autopilot-sectors.ts`, read through one helper
   (`sectorDoes`) in `src/lib/sector-autopilot.ts`. Insurance, investing and taxes switch to
   it, like debt already does. Pages and chat answers then always match what Jane really does.
2. Taxes' "use what I found" reads the Taxes sector. By default this is the same answer as
   today (the sector defaults follow the overall level), and a per-sector choice now counts.
3. The yearly reviews (216, 223, 230, and 202 when it's built) stay: each holds sector-specific checks and its
   own buttons, and they don't overlap each other. They already respect the sector caps.
4. Step 57's chooser stays as the one-tap start; it sets every sector's default.

**What users will notice:** the insurance, investing and taxes pages and Jane's answers say
exactly what their sector setting allows. **Risk:** medium-low: wording changes on three
pages; the behaviour change is limited to taxes and only for people who changed the Taxes
setting by hand. Page changes, so the PR runs end-to-end tests.

---

## Cluster 8: proactive suggestions

**Target:** every suggestion comes from one ranked source.

| Step | Today | Where |
| --- | --- | --- |
| 97 Jane notices changes | A heads-up per change (bill price rose, new subscription, paycheck late…), with "Look into it" / "That's expected". | `src/lib/changes.ts`, `sources/changes.ts` |
| 143 The next best thing | A priority engine over findings, insurance picks, refinance offers, tasks, deadlines and adopted what-if plans (`rankedFor`). Used by the brief's "Start with", `/jane`, the monthly report's "what's next", the chat's priorities answer and Claude's tools. | `jane-agent/priorities.ts`, `planning/priorities.ts` |
| 255, 259–264 Detectors and the nightly scan | Every capability's detector, ranked by dollars × confidence × urgency, top few a day, each with its confidence percentage. | `src/lib/suggestions.ts`, `src/lib/scan.ts`, `src/detectors/*` |
| 257 The one question worth asking | One profile question at a time, the one that unlocks the most dollars. | `src/lib/questions.ts`, `sources/questions.ts` |
| 265 Jane leads with suggestions | The agenda opens with the scan's suggestions. | `agenda.ts` |

**What the person sees that doesn't match**

- **Two rankings disagree.** The agenda opens with the scan's top suggestion (with its
  confidence %), while the brief's "Start with:" line, `/jane`'s top three and the monthly
  report's "what's next" use the older priority engine, which doesn't know about the scan's
  suggestions. So the person can be told two different "first things". Claude's primer already
  merges the two (scan first), in its own code.

**Merge plan** (PR "Merge: suggestions")

1. One ranked list, `topThings(snapshot)` in `src/lib/jane-agent/priorities.ts`: the scan's
   suggestions in the scan's order first (each with its confidence %), then the priority
   engine's items, without repeats.
2. The brief's "Start with", `/jane`, the monthly report, Claude's primer and its tool, and the
   chat's priorities answer all read it.
3. Changes (97) and the profile question (257) stay as their own messages: a heads-up about
   something that just happened and a question aren't suggestions to rank, and both already
   respect the daily asking budget.

**What users will notice:** the same "do this first" everywhere. **Risk:** low to medium: the
order of `/jane`'s top three changes for people with scan suggestions. Page changes, so the PR
runs end-to-end tests.

---

## Cluster 6 (noted only): older investing automation vs the practice portfolio

Three sessions are working in `src/lib/practice` and `src/planning/backtest*` tonight, so
nothing here is changed by this audit's PRs.

| Step | Today | Where |
| --- | --- | --- |
| 133 Rebalance with one tap | Orders to the stand-in brokerage for the person's own holdings, demo advice only. | `src/lib/investments/rebalance.ts`, `/investments/rebalance` |
| 134 Automatic investing | An amount every payday into the stand-in brokerage, paused when safe to spend is low. | `src/lib/investments/auto-invest.ts`, `/investments/auto` |
| 164 Fully automatic investing | Rebalances, invests new cash and harvests losses nightly at the investing sector's "Everything allowed". | `src/lib/investments/automatic.ts` |
| 216 Investing, round two | One yearly investing review message. | `src/lib/investments/yearly-review.ts` |
| 288–297 Practice portfolio | Five risk levels, a paper ledger with practice money, its own autopilot, a daily scan (`/api/cron/practice-scan`), news, backtests and cards. | `src/lib/practice/*`, `src/planning/backtest*`, `src/config/practice-scan.ts` |

**Overlap:** two autopilots for investing. 133/134/164 act on the person's (simulated) real
holdings under the investing sector caps; the practice autopilot trades a paper portfolio
with its own levels and pause switch. Both rebalance, both add money on a schedule, both
harvest losses, each with its own rules and log.

**Suggested later merge** (after the practice work lands): one rebalancing and contribution
engine with two ledgers (the stand-in brokerage and the paper ledger); the practice risk levels
become the investor profile's levels; one trade log. Keep both outcomes: practice money for
people who want to try, and the real-holdings automation for the demo bank.

## Cluster 7 (noted only): older insurance shopping vs perfect coverage

The insurance lane is still finishing Phase AU, so nothing here is changed by this audit.

| Step | Today | Where |
| --- | --- | --- |
| 104 Shopped for you | Reshops each policy before renewal and on price rises; the pick, why, runners-up; "I found car insurance $312 cheaper". | `src/lib/insurance/shop.ts`, `insurance_reshop` finding |
| 153 Life insurance, sized | A life cover needs calculation, term quotes and one-tap apply. | `src/lib/insurance/life.ts`, `/insurance/life` |
| 196 Paying less for the same cover | Pay in full, autopay, bundling, deductibles. | `src/lib/insurance/savings.ts` |
| 274–280 Perfect coverage | A need for every kind of cover, the gap, 3–4 option cards with a pick, picking queues the team. | `src/lib/insurance/need/*`, the coverage section of `/insurance` |

**Overlap:** two ways to work out life cover (153's calculation and 274's need calculators)
and two ways to show options (104's pick and runners-up, 275–276's option card).

**Suggested later merge:** life cover need from 274's calculators only (153 keeps the apply
flow); the reshop's pick shown as the shared option card (`src/lib/option-card.ts`). 196's
savings stay separate: they're about paying less for cover the person keeps.

---

## Other overlaps found along the way

| What | Today | Plan |
| --- | --- | --- |
| Weekly "what Jane did" in three places | The digest email, the weekly review and `/jane`'s timeline. | Covered by cluster 2 (the chat review folds into the brief). |
| "What I checked last night" (142) | Its own message when the agenda is off; a line in the agenda when it's on (the default). | Keep: off-agenda people still need it. |
| Alerts page (17) vs the chat's heads-ups | Urgent alerts are both on `/alerts` and a chat heads-up. | Keep: `/alerts` is the history, the chat is the moment. Already deduped by alert id. |
| Unusual activity (208) vs alerts (17) | Unusual-activity alerts are a kind of alert, shown once in the chat with "This was me". | Already one source (the alerts table). Nothing to do. |

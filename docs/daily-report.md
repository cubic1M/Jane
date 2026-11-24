# The daily report

One short email a day, from Jane to people who asked for it: what their accounts showed yesterday,
what the bank posted late, what Jane found since the last report, what changed, what is coming up,
and where the data ends if the bank hasn't updated. Off for everyone until they turn it on in
`/settings` (Email). Code: `src/lib/daily-report/`, thresholds in `src/config/daily-report.ts`.

## When

It runs inside the daily `/api/cron/digest` job (the cron stays where it is, no second cron), after the
10:00 UTC bank sync and scan. The report has its own window, 7am up to 8pm on the person's own clock
(`DAILY_REPORT_FROM_HOUR`, `DAILY_REPORT_UNTIL_HOUR` in `src/config/daily-report.ts`). It is not held to
the chat's quiet hours (9pm to 8am), which stay as they are for chat emails. Outside the window nothing
is taken, so the day isn't used up. One report per person per local day: `daily_reports` has one row
for each (person, day), unique. The row is created before the send (a second run, or a second cron at
the same moment, is refused by the unique and sends nothing) and deleted if the send fails, so the next
run tries again.

**Who the 15:00 UTC run reaches.** At 15:00 UTC (today's `vercel.json`) it is 7am in Los Angeles in
winter, so Los Angeles gets the report from that run all year, as do Denver, Phoenix, Chicago, New
York, London and UTC. It does **not** reach Hawaii (5am all year) or Alaska in winter (6am; in summer it
is 7am, inside). `window.test.ts` says so for every timezone offered on /settings. Nothing here depends
on another PR moving the cron's hour.

**Time and order.** The function has 300 seconds. The report runs after the chat, the monthly reports
and the news, so it can't starve them, and gets at most 90 seconds and never more than half of what is
left above the 60-second reserve the due jobs need (`DAILY_REPORTS_CRON_BUDGET_MS`). It stops between
people when that is used up, leaves the others unclaimed for the next run, and returns how many
(`deferred`). With one run a day, someone not reached misses that day's window.

**Follow-up (not done): a true local morning.** The plan is Pro, not Hobby (`vercel usage` shows a Pro
licence). Vercel's cron docs (checked 2026-11-23, `vercel.com/docs/cron-jobs/usage-and-pricing`) say
Pro can run a cron once a minute with per-minute precision (Hobby: once a day, ±59 minutes), and that
Cron Jobs are being migrated to "Schedules", which include timezones. So on Pro an hourly cron could
give everyone a report in their own morning: this job already skips whoever is outside their window or
already sent for their day. It changes `vercel.json` and how often the job runs, so it's a separate
decision.

## Who

`loadRecipients` (`src/lib/digest/load-recipients.ts`, shared with the weekly email): the switch on,
not deleted, at least one account. Never a trial person (`trial_` ids), never an account whose only
bank is the demo bank, never someone who hasn't opted in.

## What, and where each figure comes from

| Part | Source (the page that shows the same figure) |
| --- | --- |
| Yesterday's total, purchases, largest few | `spendingLines` and `kindOf` (src/insights/spending.ts), the insights page's lines: pending, transfers and card payments aren't spending. "Yesterday" is the person's own day (`loadComingUp`'s `asOf`); the day's total is the sum of its lines to the cent. |
| Posted since your last report | Lines a linked bank sent after the last report went (`transactions.created_at` after it, no later than this run) with a date before yesterday, within 7 days. A bank often posts a day or two late. |
| "Well above a usual day" | The middle of the days with spending in the last 8 weeks; needs 14 such days, 2.5 times and $30 above. |
| New from Jane | `suggestions` first seen since the last report (all open ones, the first time), as the chat picks them: `forRealAccount` drops advice topics and cards that tell a person what to do with money. Each shows its "% sure". |
| What changed | Alerts since the last report that weren't already emailed (urgent ones go at once, `src/lib/alerts.ts`), and the changes of `DIGEST_CHANGE_KINDS` (`loadChanges`) that no earlier report listed, each with its "% sure". A change is chosen by its key, remembered on the report that listed it (`daily_reports.change_keys`, for 30 days), not by its event date: one Jane noticed after the last report, because the bank posted its charge late, is dated earlier and is still new. Only the changes the report really lists are remembered: one cut by the list's limit (5 items, alerts first) or left out by the guardrails is still new for the next report. |
| Waiting for you | How many things wait for an answer in the chat: the Yes items bundled behind the day's open morning briefs (`refs.items`) whose own message is still open, with a link to `/chat`. It stands in for the brief's email (see below). |
| Coming up | `loadComingUp` / `comingUp`: bills, expected pay and deadlines in the next 5 days. |
| Where your data ends | `statementsReach` (src/lib/data-reach.ts) and the last bank sync, when the data stops before yesterday. Yesterday is never reported as $0 then. |

A quiet day gets a short report that says so. Every sentence passes `src/lib/guardrails.ts`
(`splitByGuardrails`), and a sentence that tells the person to act (`tellsThemToAct`, or starting with
cancel, switch, move, file, elect and the like) is left out, so what is written is what the accounts
show and what Jane sees. No account numbers, no addresses and no tokens in page links (plain paths
with UTM tags only), no tracking pixel.

**A line is in one report.** Every report takes what arrived after the last report's run clock
(`daily_reports.sent_at`) and no later than its own run clock, for suggestions, alerts and posted
lines alike. A line dated yesterday is in the day; a line dated earlier that arrives after a report
is in the next one's "posted since", and not again in the one after
(`src/lib/daily-report/send.integration.test.ts`, "a line the bank posts late").

## Urgent things

No second path. An urgent alert (a low balance coming, a charge that looks doubled) goes at once
through `src/lib/alerts.ts` as before, and once emailed the report doesn't repeat it.

## One email a day of this kind

While the daily report is reaching someone (it is on, and one went out in the last two days), the
chat's morning brief is not also emailed (`notify.ts`; the brief stays in the app). The report
carries what the brief would say: bills due, new suggestions and, because a decision is answered in
the chat and the report holds only text and a link, how many decisions wait there ("N things are
waiting for your answer in your chat", linked to `/chat`). So an email-only person is still told
about a decision waiting. Someone the report hasn't reached (the first day, or outside the 7am to 8pm
window like Hawaii at the 15:00 UTC run) still gets the brief by email, so they are never silent. Push
notifications are unchanged.

What a person with a real account and every email on can get, and the most:

| Email | When | At most |
| --- | --- | --- |
| Daily report | once a local day, 7am to 8pm | 1 a day |
| Jane's chat messages | decisions, heads-ups, what Jane did (not the brief, with the daily report on) | 1 batch a day, then only what can't wait, each in an email of its own |
| Urgent alert | a charge, a low balance, a deadline close (`src/lib/alerts.ts`) | 3 a day (`ALERT_EMAILS_PER_DAY`) |
| Weekly "what changed" | Mondays | 1 a week |
| Monthly money report | the first days of the month | 1 a month |
| Inactivity warning | before an unused bank link is removed | once |
| Sign-in link, an invite to a household | when the person or someone else asks | not scheduled |

So on an ordinary day: 1 daily report + 1 chat batch + up to 3 urgent alerts = 5, and on a Monday 6,
and in the first days of a month one more. The code doesn't bound the chat's urgent emails after the
day's batch (a bill to pay, a payday's split, a paycheck that stopped); each is its own email and each
message goes out once. Team emails (errors, ops, accuracy) go to the team only, and action status
emails are off for real accounts (read-only beta).

The Monday weekly email and the daily report may both list the same alert: neither marks an alert
emailed (only the urgent-alert path does). Left as it is.

## Records

Each send writes `audit_log` `daily_report_sent` and `analytics_events` `daily_report_sent`, counts
only. They are written after the email went, on their own: a failed audit or analytics write doesn't
turn a delivered email into a failure or give the day back to be sent twice. Each write is tried
twice, and if it still fails the log says which one wasn't recorded (the person's id, no address or
figure), so it is never dropped silently. The one-click unsubscribe (`List-Unsubscribe` header and the link in the mail,
`/api/unsubscribe?what=daily`) writes `daily_report_unsubscribed` and turns off only the daily report.

## See it locally

With a scratch database (UTC) and a person who has `daily_report_enabled` true:

```bash
curl -H "authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/digest?dry_run=1"
```

`dailyReports.previews` holds each person's subject and text; nothing is sent or stored. The tests
render a quiet day whole (`src/lib/daily-report/render.test.ts`).

## Follow-ups, not done

- A true local morning with an hourly cron on Pro (see "When").
- The chat's settings tools (`src/lib/jane-agent/settings-tools.ts`) don't mention the daily report
  switch.
- AgentMail's inbound replies aren't read (`docs/email-senders.md`).

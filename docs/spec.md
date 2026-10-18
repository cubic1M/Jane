# Financial Controller MVP — Spec and Claude Code Build Steps

*Oct 17, 2026 · @Someone*

## Summary

The MVP proves one thing: people will link their accounts and say yes to an agent acting on their money. It ships the cross-category scan, decision cards, and a concierge team that executes approved actions by hand, in about ten weeks with two or three people.

| In scope | Out of scope (later) |
| --- | --- |
| CSV import of the founders' own data first; Plaid (Transactions only) before outside users | Liabilities and Investments data |
| Rule-based detection across subscriptions, fees, idle cash, insurance, card interest | Investing, crypto, any trade execution |
| LLM-written explanations of each finding | Partner API integrations (rails) |
| "Money found" savings report | Robinhood or brokerage deals |
| Decision cards with yes / no and a full decision log | Real membership billing |
| Internal concierge queue; team executes by hand | Native mobile apps (responsive web only) |
| Weekly digest email | Moving money or holding funds |
| Willingness-to-pay test via Stripe | Adviser registration |

The build runs in eleven steps, with Plaid added at step 7 after the founders test on their own CSV data; the second half of this doc holds one Claude Code prompt per step.

## Status (Oct 18, 2026)

Steps 1–63 are built (24 came before 22, because do-it-yourself kits need its cancel links). On Oct 18, 2026 the roadmap was reordered: Phase M (Jane acts for you, steps 49–56), then Phase Q (Autopilot, steps 57–64), Phase N (the complete picture, 65–68), Phase O (plan ahead, 69–72), the rest of Phase L (73–74) and Phase P (regulated features through partners), which replaces the old Phase F. Where the build differs from the original plan, the plan below has been kept and the difference is noted here.

| Step | Shipped in | Notes |
| --- | --- | --- |
| 1–3 Foundation, auth, CSV import | PRs #1–#2 | |
| 4 Detection engine | PR #3 | Plaid PFC v2 category names |
| 5 LLM explanations and guardrails | PR #5 | Explanations written after the import response; refusals fall back to templates |
| 6 Report, decision cards, decision log | PR #6 | Card is its own page; card hash proves which version was approved; e2e tests run in CI |
| 7 Plaid linking and sync | PR #7 | Detection uses Plaid streams per account and our fallback for the rest, so CSV and Plaid data mix; CSV import kept for admins and existing CSV users |
| 8 Concierge queue and metrics | PR #8 | Non-admins get a real 404 via the proxy |
| 9 Weekly digest | PR #9 | Daily cron, one digest per person per week on their Monday |
| 10 Membership test | PR #10 | Stripe optional: Reserve always works, the paid button appears once keys are set |
| 11 Beta hardening | PRs #11–#12 | Error monitoring stored in our own database instead of a third-party service; rate limits in Postgres; ADMIN_EMAILS makes the founders admins; checklist status in docs/beta-checklist.md |
| 12 Legal pages and consent | PR #14 | Policy and terms are drafts marked for counsel review (LEGAL_REVIEWED); sign-up and existing users accept the current Terms version |
| 13 Home dashboard | PR #15 | /home is where signed-in people land |
| 14 Data export and account management | PR #16 | JSON export leaves out tokens, cursors, the MFA secret, sessions and team notes |
| 15 Spending insights | PR #22 | Transfers and card payments aren't counted as spending |
| 16 Bills and cash-flow forecast | PR #23 | Low balance ahead is a finding with no dollar estimate; checking accounts only |
| 17 Alerts | PR #24 | Only events from the last 7 days alert, so a first import doesn't flood; low balance alerts at most once per account per month; "unsubscribe" in an alert email turns alert emails off but keeps them in the app |
| 18 Refunds and disputes | PR #25 | Refunds count once (not yearly) and read "Could get back"; charge-after-cancel uses the date our team finished a cancellation; trials need 3+ days between the small and full charge so fuel and hotel holds don't match; the double-charge alert and finding share one rule; the request_refund playbook starts src/config/playbooks.ts (more in step 21) |
| 19 Bill negotiation | PR #26 | Phone and internet/TV only: insurance stays with insurance_reshop, since one price range would mislead; the ranges are our own estimates from published list prices, marked for review; the guardrails reject any bill card that doesn't say "typical price"; the call script is in src/config/playbooks.ts |
| 20 Debt payoff planner | PR #27 | /debt, linked from card interest cards; runs in the browser from balances on linked cards, with APR and minimums typed by the person; strategies named "highest rate first" and "smallest balance first" (avalanche and snowball as asides); no Claude text, and all planner wording is checked by a new "recommends a choice" guardrail |
| 21 Team playbooks and drafted messages | PR #28 | Drafts are built from the privacy-safe explain input, cut to the facts each request needs, with [placeholders] for the person's name and email; no draft for moving cash, insurance quotes or due-date changes (no single company to write to); drafts aren't stored, each one is audit-logged |
| 24 Merchant directory | PR #29 | Built before 22 and 23; seeded with 21 common subscriptions in the migration (from src/config/merchant-seed.ts, all unreviewed); detection gives directory merchants one name and fills missing categories; one-word names match exactly, so "Apple Store" isn't Apple's subscriptions; no seeded prices (they change too often), the team adds them when reviewing |
| 22 Do-it-yourself kits | PR #30 | A third answer on the card ("I'll do it myself"), stored as a decision with choice diy and no action; kits for cancelling, price increases, refunds, bank fees (email via mailto) and bill negotiation (call script); "I did it" sets diy_done_at and the finding to done; approval rate counts do-it-yourself as a yes |
| 23 Ask Jane | PR #31 | Answers are held until the guardrails pass, so the stream shows what Jane is looking up and then the whole answer, never unchecked text; allowed figures are those in tool results, the question and earlier answers; tools return cleaned-up merchant names (transfers just say "Transfer"), never raw descriptions or account names; Claude uses adaptive thinking with a manual tool loop; checked against the real API only by an opt-in live test |
| 25 Household sharing | PR #32 | Two people per household; invite links work only for the invited email, once, for 7 days, and are shown to the inviter (emailed too when email is set up); partners see only undecided findings that sit entirely on shared accounts, so no decision can be read off a status; sharedReadFor in db-scoped.ts is read-only by construction and checks membership on every call |
| 26 Installable app and notifications | PR #33 | Icons are drawn by a route (no image files); the service worker caches only the offline page, never pages with data; installability is checked by tests against Chrome's criteria, since Lighthouse 12 dropped its PWA category and can't run in CI here; push needs VAPID_* keys and the person turning it on per device, then urgent alerts go to the phone instead of email (email if no device takes it), under the same daily cap |
| 27 Partner referrals | PR #35 | Partners live in the database (/admin/partners), not config; people pick their state in settings, and with no state no partner is offered; conversions are entered by hand on the action page (no partner webhooks yet); insurance stays off in code until COUNSEL_INSURANCE_REFERRALS.approved; turning a partner off changes the card hash, so an answer to a card that still showed it is refused |
| 28 Category corrections | PR #37 | /transactions lists recent transactions with a category picker; "always for this merchant" stores the person's own merchant_categories row (source user), applied before Plaid, keyword rules and Claude; Plaid's later changes to a transaction keep a corrected category; findings are refreshed after the response |
| 29 Budgets | PR #38 | Budgets are per insights category name (e.g. "Food and drink"); spending comes from the same loader and spendingInsights as /insights, so totals match exactly; the suggestion is the person's own three-month average, rounded up to $10, shown in brackets as a starting point; over_budget is a new non-urgent alert type keyed by category and month |
| 30 Savings goals | PR #39 | Progress is a linked account's balance or an amount entered by hand; months are counted by day of month (Oct 20 to Apr 20 is 6), and the monthly amount is rounded up to the cent so it reaches the target; every sentence about the math passes the recommendation guardrail |
| 31 Net worth over time | PR #40 | Snapshots are taken by the existing daily job (no new cron), for CSV accounts too, and kept two years; a month's value is each account's last snapshot in or before it, so quiet months carry forward; credit and loan balances are debts; accounts with no balance are left out and named |
| 32 Bill reminders | PR #41 | A bill_due alert 1 to 3 days before each expected bill, keyed by merchant and due date; alerts can now set their own urgency, so a reminder is urgent (and emailed, within the daily cap) only when the account's forecast balance that day is under the low-balance cushion |
| 33 Accessibility | PR #42 | axe found 40 serious problems, nearly all dark-mode text contrast; fixed once in globals.css (lighter shades for brand and status text in dark mode) rather than page by page, plus the household share button's accessible name; e2e/accessibility.spec.ts checks every page signed out, signed in and as the team, in light and dark mode |
| 34 Metrics at scale | PR #43 | /admin/metrics now runs SQL aggregates (src/lib/metrics-sql.ts); computeMetrics stays as the readable definition, and a test checks both agree on one database snapshot; jobs live in a Postgres table claimed with SKIP LOCKED, retried at 1, 5, 30, 120 and 720 minutes, then shown at /admin/jobs; explanations after imports and syncs are the first job kind; due retries run in the two daily crons (and whenever a new job runs), since cron frequency may be limited to daily |
| 35 Year in review | PR #44 | /year (any year with data) builds on spendingInsights month by month and on saved-to-date limited to the year, so the figures match those pages; "what Jane found" counts findings created that year; prints cleanly (navigation and footer hidden) via the browser's print, which also saves a PDF |
| 36 Subscriptions and renewals | PR #46 | /subscriptions lists every active recurring charge from the same streams as the subscription findings and bills forecast (yearly cost and next date agree), split into subscriptions and other bills; renews_soon alerts come 7 days before a yearly or quarterly renewal, keyed by stream and date; yearly charges need Plaid's recurring streams, since 12 months of transactions show only one charge |
| 37 OFX and QFX import | PR #47 | OFX/QFX files go through the same upload, preview and import path as CSV (recognized by extension or header); one reader handles SGML 1.x and XML 2.x; the bank's FITID is the dedupe key, so re-importing adds nothing; amounts are flipped to Plaid's sign; files are read in memory and never stored |
| 38 Money calendar feed | PR #48 | An iCalendar feed at /api/calendar/<secret>.ics with expected bills and deposits for 60 days and goal dates; only a SHA-256 of the secret is stored, so the link is shown once (with a webcal: "add to calendar" link) and making a new one or turning it off kills the old one; deposits are "Expected deposit" without the payer's name; UIDs are built from merchant and date so events update in place |
| 39 A weekly email about your plans | PR #49 | The digest adds budgets at 90% or more of their limit, every goal (with the week's change for goals tracked by an account balance), and net worth's change since last week (only once a week-old snapshot exists); each comes from the same function as its page; these sections count as content, so people who use them get a weekly email |
| 40 Smarter merchant directory | PR #50 | The daily job rebuilds merchant_outcomes (counts and median minutes per merchant and action type, no user or action ids) from finished cancel, price, refund and bill actions, joining statement names through the directory; nothing shows below 5 cases; the team sees "usually about N minutes; X of Y worked" on actions, people see "usually takes about N minutes" on do-it-yourself kits |
| 41 Team workload | PR #51 | Assignees are picked from the team (admins by email) and checked on save; the queue shows "who has what" (open and overdue per person, overdue by the queue's own business-day rule) and filters by assignee; saved replies (/admin/replies) fill in what the person needs to do; assignments and saved replies are audit-logged |
| 42 Health checks | PR #52 | Each daily job's run is recorded (cron_runs); /admin/health shows the last and last good run of each, linked banks, background jobs and errors in the last day (audit-logged); each daily job checks the others when it starts and emails each address in ADMIN_EMAILS about one missed for over 26 hours, once per outage (health_notices); if every job stops, only the health page shows it |
| 43 Data retention | PR #53 | RETENTION_PERIODS in src/config/retention.ts drives both the daily cleanup (usage events 395 days, error reports 90, finished jobs 30, cron runs 90, rate-limit counters 1, expired sessions and sign-in links at once) and the privacy page's retention list, which is generated from it; a test renders the page and checks every line, and that every configured kind has a cleanup |
| 44 Safe to spend until payday | PR #55 | Shown on Home when there's a checking balance; payday is the next expected deposit from income streams; bills are the forecast's regular bills charged to checking before payday (card bills come off the card); budgets count what's left this month, goals this month's amount; every part is listed under "How we worked it out"; with no deposit expected it says so and covers the 31-day window |
| 45 Monthly check-in | PR #56 | /check-in shows the month just ended (or any earlier month): spending against the month before and its biggest changes, budgets kept, net worth change (from snapshots), what Jane found and what got done; Claude writes 2-3 sentences from those figures only, checked by the guardrails with a template fallback, stored per person and month; the email goes out in the first 7 days of the month (person's timezone), once, only to people who get the weekly email, never for an empty month |
| 46 Shared bills | PR #57 | On /household either partner can split a charge from the last 45 days on a shared account (half by default; the split is stored in basis points); both see the same running balance, "Settle up" records a settlement that zeroes it; leaving the household or deleting your data ends the shared balance (shared charges and settlements are deleted) while each person's own transactions stay; the data export holds the charges you paid and the settle-ups you were part of |
| 47 First week with Jane | PR #58 | A "Getting started" card on Home for the first 28 days: link a bank or import a statement, decide on 3 cards (undone decisions don't count), set a budget or a goal, choose how alerts reach you (saved alert settings or a phone with notifications on); each ticks from real data, never from the checklist; the first time each is seen done Home records it (users.checklist_progress) and sends checklist_item_done once, then checklist_completed; "Hide this for good" sets checklist_dismissed_at and sends checklist_dismissed |
| 48 Two-factor for everyone | PR #59 | Anyone can turn it on from /settings (an authenticator app, the same TOTP as the team's); the first code makes 10 backup codes, shown once and stored as SHA-256 hashes, each working once (case, spaces and dashes ignored); every session after that must enter a code or backup code at /mfa before any page or API answers (API routes treat it as signed out); new backup codes and turning it off need a current code, and admins can't turn it off; the session lookup (/api/auth/session) no longer returns the session token, which it used to, so a script on a page could have read it |
| 49 Jane's plan | PR #61 | /plan lists every open finding as a proposed action: time-sensitive types first (low balance, double charges, charges after cancelling, trial conversions, in that order), then by money a year; Yes / No / Change on each, "Yes to all" (one decision per item, each checked against its card hash, then back to the plan with the counts); Change edits the options in src/config/plan.ts (cancel or downgrade, what to ask for, refund or dispute, a target price, cash to keep), stored as decisions.options in cents and shown to the team on the action page; every answer is a normal decision with source "plan"; a No can be undone for a few seconds; Home shows a banner with the count; the weekly email now goes out whenever something waits on the plan, with a link to /plan, plus a phone notification where push is on. Snoozing isn't built: a No resurfaces only when the finding changes, as before |
| 50 Standing rules | PR #62 | Five rules in src/config/rules.ts, off until turned on in Settings: refunds on double charges, refunds after trials and cancellations, bank fee refunds, pushing back on price increases (up to a yearly amount the person sets), and asking for a lower card rate; each has a monthly limit (1, 3, 5 or 10). After every scan, open findings that match an enabled rule are approved as decisions with source "rule" and the rule's key; a phone notification goes out where push is on, and /plan lists the last day's rule approvals with "Take back" (only while the action is still queued; the finding returns to the plan and rules leave it alone from then on). Moving money, bill negotiation (phone calls), cancelling subscriptions, insurance and cash-flow reviews can never be approved by a rule (NEVER_BY_RULE, tested) |
| 51 The action agent | PR #63 | Approved refunds (double charges, trials, charges after cancelling) and price-increase pushback are worked by the agent (AGENT_ACTION_TYPES): it drafts the email (Claude or the template, guardrailed, the person's name and account email filled in), sends it from Jane's address with a reply-to unique to the action, reads the reply (Claude, or plain word rules when Claude isn't available) and acts: done, a question for the person (answered on /actions; full card or account numbers refused), the person must contact them, or hand-off to the team with the reason (a refusal, an unclear reply, no support email in the directory, no reply after 2 follow-ups 3 days apart). The team's queue shows only handed-off agent actions, each with the reason; the action page and /actions show every email. Companies' replies arrive at POST /api/agent/inbound (shared-secret auth). Without agent email set up, development uses a simulated company mailbox that answers like a support team; production hands everything to the team. Support emails are added by the team in the merchant directory, never guessed |
| 52 Refunds and fees, done by the agent | PR #64 | Bank fee refunds join the agent's actions: it writes to the bank that holds the account (the institution of a linked bank; a file import doesn't say which bank, so those go to the team with that reason). After every scan, open or finished refund actions look for the money coming back in the person's transactions: a credit from the same merchant, or a fee reversal on the same account, on or after the day it was approved, of at least half what was asked (REFUND_MATCH_MIN_SHARE); each credit confirms one refund. A refund seen closes the action if a reply hadn't, records refund_seen_at and refund_cents, and "saved so far", the year in review and the weekly email count what came back instead of the card's estimate. Merchant outcomes come from the actions' results as before |
| 53 Cancellations and price fights, done by the agent | PR #65 | Cancellations join the agent. Where the merchant directory has a cancel page but no support email (Netflix, Hulu and most seeded companies), the person gets an "Open their cancel page" button and "I've cancelled it"; Jane then waits until the next charge was due (from the last charge and how often it charged) plus 5 days' grace, and calls it done only if no charge came; a charge in the meantime goes to the person and the team. Otherwise the agent emails the cancellation and a written confirmation closes it. The plan's choices shape the request: downgrade instead of cancel, a loyalty discount or a cheaper plan instead of the old price; "dispute it with my card" goes to the team. A charge after a cancellation Jane did becomes a refund request on its own (decision source "auto", logged as a follow-up of the earlier yes). Price-increase requests were already the agent's since step 51 |
| 54 Phone negotiation | PR #66 | Bill negotiation joins the agent, by phone (AGENT_CALL_TYPES). A call needs the person's own yes on that bill: rules and automatic follow-ups can't start one (NEVER_BY_RULE, and checked again before calling). The script: the call may be recorded, who Jane is and who it calls for, the request, the typical price and what they pay (guardrailed, with the required "typical price" wording), and never accepting a contract, fee or new plan on the call. Outcomes: a lower price closes the action and counts (old minus new) times twelve as saved (actions.confirmed_annual_cents); an offer goes to the person to accept (the team puts it in place) or decline; account-holder-only goes to the person and the team; a refusal or no answer goes to the team. The script and transcript are on the timeline. No calling service is connected yet: development uses a simulated call, production hands calls to the team, and a service, once chosen, posts results to POST /api/voice/result (shared-secret auth). Card interest calls stay with the team, since a standing rule may approve those |
| 55 Jane drafts budgets and goals | PR #67 | /plan has a "Set up, from your own numbers" section: budgets for the three biggest spending categories without one (their own 3-month average, rounded up, at least $20), an emergency fund of 3 months of their own average spending to reach in 12 months (unless they have one), and a category for merchants with no category that the merchant directory knows (never guessed). Each is Yes / No / Change (amount, date, category); nothing is created until yes, and a no is remembered so it doesn't come back. Proposals refresh after every scan and when the plan opens, and are labelled as math from their data, not advice (plan_proposals, src/config/proposals.ts). Change panels no longer push the plan sideways on a phone |
| 56 What Jane did | PR #68 | Every agent step is on the action's timeline in plain words: emails and replies, calls and transcripts, and notes for the steps that aren't messages (passed to the team and why, asked to cancel on the company's page, cancelled and watching, no charge so done, charged again, a refund seen, an offer accepted or declined). Home has a "What Jane did this week" card and the weekly email a matching section: things finished, money confirmed back or saved (only refunds seen in transactions and prices confirmed on a call, never estimates or written promises), emails and calls made, what's still in progress and what waits on the person |
| 57 Autopilot levels | PR #69 | One choice instead of rule-by-rule settings: "Handle the safe stuff" (recommended: refunds for double charges, trials and fees, the old price back on increases up to $120 a year, a lower card rate; up to 5 a month each), "Handle everything allowed" (the same kinds, no size limit on increases, 10 a month) and "Ask me first" (no rules); levels live in src/config/autopilot.ts and can only switch on standing rules, so never money, calls, cancellations or insurance. A one-tap chooser shows on Home and the plan until the person picks; picking applies the rules at once and the agent starts on what they approved (each can be taken back for a day). Settings shows the level, with the standing rules as "Fine-tune" (which makes it "custom"). Also: the team queue skips an action whose person was deleted mid-request, and three shared-database test clashes are fixed |
| 58 Jane answers companies' questions itself | PR #70 | When a company asks for something Jane holds (the card's last 4 digits from the account the charge was on, the account email, the account holder's name, the charges' dates and amounts), the agent answers from the person's own records (built from the data, never written freely) and notes it on the timeline; the person is asked only when something asked isn't known. Passwords, PINs, security questions, full card or account numbers, Social Security numbers, birth dates and one-time codes are never given out: the person is warned that asking by email is unusual and the team follows up (src/lib/agent/auto-answer.ts) |
| 59 One tap for the whole week | PR #71 | The plan opens with "This week, Jane will": every item as a checkbox, already ticked for what Jane would do, and one "Go ahead with N" button (the count follows the ticks). Low-confidence findings, cancellations (anything the person may still use) and moving money start unticked (PLAN_NEVER_PRESELECTED in src/config/plan.ts). Going ahead records one plan decision per ticked item, each checked against its card hash; unticked items stay on the plan with their own Yes / No / Change below. The plan's link now points to the Autopilot settings |
| 60 Approve from email or phone | PR #72 | The weekly email (and its notification) carries a one-tap link for the week's ticked, no-risk items (never calls, cancellations, moving money or insurance). The link opens a small page with one button, so email scanners that open links can't approve anything; no sign-in is needed, the link's token is the credential. Only a hash is stored (plan_links), never the token, and the stored digest never holds it; a link works once, for a week, for that person and those items, each checked against its card. Approvals are logged as source "link". The same link then offers "Take it back" for an hour. Also fixed: approvals made outside the app (a standing rule's, a link's) now wait before the agent starts (24 hours and 1 hour, AGENT_HOLD_HOURS), so "take it back" really works; before, the agent started within seconds |
| 61 Cancellations confirm themselves | PR #73 | When Jane gives the person a company's cancel page, it starts watching for the next charge right away (confirm_after from the last charge and how often it charges, plus grace); "I've cancelled it" is optional. No charge by then closes the cancellation ("since Jane gave you their cancel page"). A charge in the meantime from someone who didn't say they'd cancelled is a reminder to cancel, and Jane watches the next cycle; a charge after they said they had still goes to the person and the team |
| 62 Call offers within your limits | PR #75 | One setting under Autopilot: "On bill calls, accept any lower price with no contract and no fee" (users.accept_simple_offers; on with "Handle everything allowed", off with "Ask me first"). With it on, the call script allows a lower price on a different plan of the same service if there's no contract and no fee, and such an offer closes the bill with its confirmed savings (noted as accepted within the limit); anything with a contract or a fee always comes to the person. Call results can carry the offer's terms ({ monthlyCents, contractMonths, feeCents }) |
| 63 Set-up done for you | PR #74 | Categories the merchant directory knows are filed on their own after each scan (they change no money; the plan says which and links to /transactions to change or undo), except for "Ask me first". Budgets and the emergency fund are one "Use Jane's N suggestions" tap on the plan, or Yes / No / Change each as before |
| 64 Jane finds support contacts | PR #76 | When the merchant directory has no support email for a company the agent must write to, it no longer just stops: it hands the request to the team as before and queues a lookup (job find_support_contact). Claude searches only the company's own website (web search limited to the domain of the directory's cancel or support link) and keeps an address only if both it and the page it came from are on that domain (https), so a look-alike like netflix.com.evil.example is refused. The address is stored as a suggestion (merchants.suggested_support_email, with its source page) and shown on /admin/merchants under "Support emails Jane found" with Use it / Not right. Using it, or saving a support email by hand, picks the waiting requests back up on their own. Needs ANTHROPIC_API_KEY; without it nothing is looked up and the team adds the address as before |
| 65 Loans and mortgage | PR #77 | New bank links ask Plaid for Liabilities as an optional product (only where the bank supports it, so no bank drops out of Link and nothing extra is billed elsewhere); items linked before keep working as they were and are never called (plaid_items.liabilities). Each sync then reads /liabilities/get: credit cards (purchase APR, minimum, due date), mortgages, student loans and other closed-end loans (Plaid's newer `loan` list, which covers car loans), and the LIABILITIES DEFAULT_UPDATE webhook syncs again. Loan accounts are kept for their balances (so net worth counts them by itself) but not their transactions. Rates, payments and dates go in a new liabilities table, in basis points and cents; account numbers, addresses, guarantors and reference numbers are never stored. The debt planner fills in each card's and loan's rate and minimum from the bank (mortgages left out, PLANNER_LEFT_OUT_SUBTYPES), still editable. New /loans page (linked from Home): what you owe, due each month, and each card and loan with its rate, payment, next due date (marked when due within a week), payoff date, interest paid this year, and the bank's overdue flag first. Nothing is estimated: a missing detail shows as "Not reported". Included in Download my data |
| 66 Investment and retirement balances | PR #80 | New links also ask Plaid for Investments as an optional product (plaid_items.investments; earlier links are never called). Each sync reads /investments/holdings/get for the accounts' balances only: holdings and securities are dropped, never stored, and trades on those accounts aren't kept as transactions. Investment accounts (type investment, or brokerage in old API versions) are kept as a retirement account (401k, IRA, Roth, pension and the like) or an investment account, and count toward net worth, which now says how much of what you have is in them. The HOLDINGS DEFAULT_UPDATE webhook syncs again. The guardrails now also reject any text about buying, selling or holding positions, funds or shares, rebalancing, allocation, or how investments performed. The demo bank has a 401(k) and a brokerage account |
| 70 Saving for irregular costs | PR #81 | Bills that come less often than monthly and seasonal spending now become a monthly amount to set aside (src/insights/irregular.ts, thresholds in src/config/irregular.ts). Jane finds quarterly and yearly charges (from Plaid's streams or our own detection), bills paid twice a year, a yearly bill seen once when its category or name says so (car registration, licences, annual fees), and seasons like holiday gifts in November and December when shopping is well above the usual month. Each has its yearly total, next date and monthly share (yearly / 12, rounded up to the dollar); nothing from loan or investment accounts, transfers or loan payments. /budgets lists them under "Set aside for yearly bills" with how much should be put by now for each. Safe to spend takes this month's share off as its own line (a "Yearly bills" goal isn't counted twice). The plan proposes a "Yearly bills" savings goal of a year of the monthly total, included in "Use Jane's suggestions"; a no is remembered and anyone with such a goal gets none. The demo bank now has a yearly DMV registration and holiday gifts |
| 72 Life events and tax-time pack | PR #N | New /life-events page (linked from Home): start a checklist for moving, a new job or a new baby (src/config/life-events.ts, 8 plain items each, some linking to Budgets, Goals, Subscriptions or the report), tick items off, finish or delete it; one open checklist per kind, kept in a new life_events table and included in Download my data. New /tax-pack page (linked from Home), for last year until April 30 and this year after, or any of the last six years: charity gifts, then "Spending people often show their tax preparer" (medical without vet bills, childcare, education, and this year's student loan and mortgage interest as the bank reports it), each with dates, payees and totals, and contracting or gig income by quarter with the IRS estimated-payment dates (April 15, June 15, September 15, January 15; src/config/tax-pack.ts, pointing to irs.gov). Organizing only: static wording in src/planning/tax-pack-copy.ts, no Claude text, never "deductible", "write-off" or what to pay. Download as CSV (the person's own transactions, spreadsheet-formula safe, audit-logged). People with contracting or gig income get an in-app alert 14 days before each estimated-payment date, once per date (alert type estimated_tax). The demo bank has two Red Cross gifts, pharmacy and dentist charges |
| 75 Demo bank | PR #78 | A stand-in for Plaid until there are keys. "Link a demo bank" on /connect makes an ordinary plaid_items row (ids start with demo-; the encrypted access token names the demo seed and the day it was linked) that the normal sync, daily refresh and removal handle; a fake Plaid API (src/lib/plaid/demo.ts) answers in Plaid's place and never calls Plaid. It holds checking, savings, a credit card, a mortgage, a student loan and a car loan, a year of Plaid-shaped transactions with real PFC categories (src/data-sources/demo/demo-bank.ts) and loan details. The data is deterministic (later syncs add only the new days) and built so every finding shows up: a Netflix price rise, high phone and internet bills, overdraft and service fees, card interest, a converted trial, a duplicate charge, insurance, subscriptions and idle cash. A banner on every signed-in page says it's fake data and links to removing it. Offered only when Plaid isn't set up and outside production, or anywhere with DEMO_BANK=1 |
| 76 The best option for you | PR #79 | Cards for a phone or internet bill, a subscription (price rise or review) and idle cash now compare the options Jane knows and pick the best one for the person: the lowest first-year cost (fees included) for the same kind of service, or the savings account they qualify for that earns the most (src/planning/compare.ts). The card shows "The best option for you" with Jane's pick already selected, up to two runners-up (price, saving, what's included, contract, fee, what's given up, the day the price was checked and its source) and "Don't switch" (the old action); one yes switches. The choice is checked against the comparison and kept on the decision as it was shown. Options live in switch_options, kept by the team on /admin/options (add, "Checked today", remove); only options checked on the provider's own page in the last 90 days (OPTION_STALE_DAYS) and saving at least $24 a year are compared. Never insurance or investments. Example options with made-up providers exist only for people using the demo bank, labelled "Example, not a real offer" |
| 77 Jane switches for you | PR #79 | A yes on a switch becomes one action (agent state switching), whatever the finding: the person gets one "Sign up for …" button and Jane watches the account (after each sync and daily). A cheaper tier is done when the cheaper charge shows up; another provider's plan when its first bill shows up, and only then does the team cancel the old one, so the person is never without service; a savings account when the money is seen moving out (Jane never moves money). The saving is counted from the real new charge. No sign of it in 45 days (SWITCH_WATCH_DAYS) passes it to the team. On the demo bank, the new bill arrives two days after a switch so the whole loop can be tried |

Still needed from a person before outside users: counsel (insurance referral licensing, privacy policy and terms), Plaid Production approval and questionnaire, a backup restore test, and admins enrolling in two-factor. See docs/beta-checklist.md.

## Success metrics

Set each target before the beta opens, so results can't be reinterpreted afterwards. Every metric comes from events the app logs from step 1.

| Metric | Definition | Target |
| --- | --- | --- |
| Link rate | Signed-up users who link at least one account | Set before beta |
| Money found | Median annual savings identified per linked user, in dollars | Set before beta |
| Approval rate | Cards approved / cards shown, per finding type | Set before beta |
| Completion rate | Approved actions the team completes successfully | Set before beta |
| Willingness to pay | Users who reserve or pay for membership after their first completed action | Set before beta |
| 30-day retention | Linked users who open the app or a digest in days 23–30 | Set before beta |
| Minutes per action | Team time spent per completed action, per type | Tracked; drives what to automate first |

## Architecture

The MVP is one Next.js app with a Postgres database; every outside service is a managed API, and the only "partner rail" is your own team.

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js (App Router), TypeScript, Tailwind | One codebase for pages, API routes and admin |
| Database | Postgres with Prisma | Relational data, easy migrations |
| Auth | Auth.js, magic link and Google | No passwords to store |
| Bank data | Plaid, Transactions only | Read-only, cheapest product set |
| LLM | Anthropic API | Finding explanations and edge-case classification |
| Payments | Stripe Checkout | Willingness-to-pay test without building billing |
| Email | Resend | Magic links, status updates, digests |
| Analytics | PostHog | Funnel and success metrics |
| Hosting and jobs | Vercel and Vercel Cron | Deploys and scheduled sync, digest, cleanup |

## Data model

Twelve tables in Postgres. Money is stored as integer cents, timestamps in UTC, and every user-owned row cascades on account deletion.

| Table | Purpose | Key fields |
| --- | --- | --- |
| users | One row per person | id, email, name, created_at, deleted_at |
| plaid_items | One per bank login | id, user_id, plaid_item_id, access_token_encrypted, institution_name, status, transactions_cursor, last_synced_at |
| accounts | Accounts inside an item | id, item_id, plaid_account_id, name, mask, type, subtype, current_balance_cents, available_balance_cents |
| transactions | Synced transactions | id, account_id, plaid_transaction_id, date, amount_cents, merchant_name, pfc_primary, pfc_detailed, pending |
| recurring_streams | Recurring charges from Plaid | id, account_id, plaid_stream_id, merchant_name, frequency, last_amount_cents, average_amount_cents, last_date, status |
| findings | One detected opportunity | id, user_id, type, title, explanation, annual_savings_cents, confidence, evidence (json), status, created_at |
| decisions | A user's yes or no on a card | id, finding_id, user_id, choice, card_snapshot (json), created_at |
| actions | Concierge work from a yes | id, decision_id, type, status, assignee, notes, minutes_spent, started_at, completed_at |
| digests | Weekly emails sent | id, user_id, week_start, payload (json), sent_at, opened_at |
| membership_intents | Willingness-to-pay test | id, user_id, kind (reserve or paid), stripe_session_id, amount_cents, created_at |
| audit_log | Every sensitive event | id, actor_id, actor_type (user, admin, system), event, target_type, target_id, metadata (json), created_at |
| analytics_events | Funnel events | id, user_id, name, properties (json), created_at |

Finding types: `subscription_review`, `duplicate_subscription`, `price_increase`, `bank_fees`, `idle_cash`, `insurance_reshop`, `card_interest`.

Finding status: `new`, `shown`, `approved`, `declined`, `in_progress`, `done`, `failed`.

Action status: `queued`, `in_progress`, `waiting_on_user`, `done`, `failed`.

## Detection rules

Rules come first and decide what counts as a finding; the LLM only explains and classifies edge cases. Every threshold lives in one config file so it can be tuned during the beta. Savings estimates are conservative and labelled as estimates on the card.

| Finding | Trigger | Annual savings estimate |
| --- | --- | --- |
| Subscription review | Active recurring outflow stream with a subscription-like merchant or category | 12 × monthly amount, counted only if the user approves a cancel |
| Duplicate subscription | Two or more active streams in the same service category (e.g. two music services) | Annual cost of the cheaper one |
| Price increase | Latest charge on a stream is ≥ 5% above its previous average | 12 × the increase per month |
| Bank fees | Transactions in Plaid's bank-fee categories (overdraft, ATM, maintenance) in the last 12 months | Sum of fees in the last 12 months |
| Idle cash | Depository balance above 3 × average monthly spending | Excess balance × (reference high-yield rate − assumed current rate); both rates in config |
| Insurance reshop | Recurring payment in Plaid's insurance category | Not estimated in dollars until a partner quote exists; card shows "could be lower, get quotes" |
| Card interest | Interest-charge transactions on credit accounts in the last 12 months | Sum of interest in the last 12 months |

Rules for the engine:

- Category names must be checked against Plaid's current personal finance category taxonomy before coding; the names above are descriptive, not exact
- A finding is created once and updated in place on later scans, never duplicated
- Each finding stores its evidence (transaction ids, amounts, dates) so the card can show why
- The "money found" total sums only findings with a dollar estimate and confidence ≥ medium
- Rates, thresholds and multipliers are configuration, never hard-coded in the rule logic

## Screens and user flow

A new user goes from landing page to their savings number in under five minutes; everything after that is cards and status.

1. Landing page: one promise ("See how much money you're losing"), waitlist or sign-up
2. Sign up: email magic link or Google
3. Connect accounts: short trust explainer (read-only, revoke anytime), then Plaid Link; add more accounts afterwards (the founders' first round uses CSV upload instead)
4. Scanning: progress state while transactions sync and rules run
5. Savings report: headline "money found per year", findings sorted by dollars, each opening a card
6. Decision card: what changes, savings per year, what you give up, alternatives, referral disclosure if any, yes / no
7. Action status: each approved action with its live status (queued, in progress, waiting on you, done)
8. Membership offer: shown after the first completed action; reserve or pay
9. Settings: connected accounts, disconnect, delete all my data, email preferences

Internal screens, admin only:

- Concierge queue: approved actions to work, filtered by type and status
- Action detail: the user's card snapshot, evidence, notes, status buttons, minutes-spent field
- Metrics: the success metrics table, live

## Concierge back office

Every yes becomes an action in the queue, and a team member finishes it by hand within one business day. The user sees status updates as if the agent did it; the team logs minutes spent so the most time-consuming, most-approved actions get automated first.

| Action type | What the team does | User involvement |
| --- | --- | --- |
| Cancel subscription | Cancels via the merchant's site or support using the user's guidance; or sends the user a one-click cancel link plus steps | May need the user to log in or forward a confirmation |
| Fight a price increase | Contacts the merchant to request the old rate or a retention offer | None, unless the merchant requires the account holder |
| Recover bank fees | Drafts and sends a fee-reversal request, or gives the user a script | User may need to call or send it |
| Move idle cash | Sends a guided link to a partner high-yield account and the transfer steps | User opens the account and moves money themselves |
| Insurance reshop | Sends a referral link to a licensed marketplace, with the user's current policy details prefilled where allowed | User completes quotes and the switch |
| Card interest | Sends a payoff-order plan or a balance-transfer option | User acts |

Queue rules:

- Nothing is ever done without a logged yes; the card snapshot is attached to the action
- The team never stores the user's passwords for other services; if a login is needed, the user does that step
- Status changes notify the user by email; "waiting on you" includes exactly what they need to do
- Failed actions record the reason, so the card copy and rules can be fixed

## Security and compliance checklist

The MVP avoids adviser registration by giving no investment advice and moving no money; these items must all be ticked before the first outside beta user links an account. Confirm the legal items with counsel.

- [ ] Plaid access tokens encrypted at rest (AES-256-GCM, key from a secrets manager, never in the repo)
- [ ] Read-only Plaid products only; Transactions alone in the MVP
- [ ] Plaid webhooks verified before processing
- [ ] Admin screens behind role check and MFA; every admin view of user data written to the audit log
- [ ] "Delete all my data" removes every Plaid Item (`/item/remove`) and all rows for the user
- [ ] Inactive Items removed on a schedule to stop Plaid billing
- [ ] No investment, tax or legal advice in any card or LLM output; a guardrail check on LLM text before display
- [ ] Referral relationships disclosed on any card that uses one
- [ ] Counsel has confirmed whether insurance referral fees need a license in your launch state
- [ ] Privacy policy and terms published, covering Plaid data use, retention and deletion
- [ ] Plaid's security questionnaire answered truthfully for Production access
- [ ] Rate limiting on auth and API routes; dependency and secret scanning in CI
- [ ] Backups enabled and a restore tested once

## Non-code setup tasks

Start these in week 1; several have lead times longer than the code they unblock.

| Task | Why | When |
| --- | --- | --- |
| Incorporate and open a business bank account | Required for Plaid, Stripe and partner agreements | Week 1 |
| Plaid: sign up for the free Trial (10 Items) | Optional shortcut: your own accounts without CSV exports; free up to 10 Items | Week 1 |
| Plaid: apply for Production access, pay-as-you-go | Security review takes time; needed before outside users | Week 1 |
| Stripe account | Willingness-to-pay test in step 9 | Week 2 |
| Anthropic API key | LLM explanations in step 5 | Week 2 |
| Domain, email sending domain with SPF, DKIM, DMARC | Magic links and digests must land in inboxes | Week 1 |
| Hosting and managed Postgres accounts | Deploy from step 1 | Week 1 |
| Analytics account (e.g. PostHog) | Funnel events from step 1 | Week 1 |
| Counsel: insurance referral question, privacy policy, terms | Compliance checklist items | Weeks 1–3 |
| Referral partners: one insurance marketplace, one high-yield account | Concierge actions need somewhere to send users | Weeks 2–6 |
| Beta list: 20 friendly users, then 50–200 | Step 10 and the beta | Weeks 4–7 |

## Using Claude Code

Put the CLAUDE.md below in the repo root first; Claude Code reads it at the start of every session, so each step's prompt can stay short. Then run the build steps in order, one session per step.

Workflow for every step:

1. Start a fresh Claude Code session in the repo and paste the step's prompt
2. Ask it to plan first ("Make a plan before writing code"), review the plan, then let it build
3. When it says it's done, run the tests and click through the acceptance criteria yourself
4. Review the diff, commit, and push; deploy to staging
5. Only then start the next step

CLAUDE.md:

```markdown
# Financial Controller MVP

## What this is
A web app that links a user's bank accounts through Plaid, finds money they are
losing (subscriptions, fees, idle cash, insurance, card interest), and shows each
finding as a decision card. When the user approves, an action is queued for our
concierge team, who complete it by hand. No money movement, no investing, no
investment advice in this MVP.

## Stack
- Next.js (App Router) + TypeScript, strict mode
- Tailwind CSS for styling
- Postgres with Prisma ORM; money as integer cents, timestamps UTC
- Auth.js: email magic link and Google sign-in
- CSV import of the founders' own data first; Plaid Node SDK (Transactions
  only) added in step 7 behind the same DataSource interface
- Anthropic SDK for finding explanations; model name from env ANTHROPIC_MODEL
- Stripe Checkout for the membership test
- Resend for email
- PostHog for analytics events
- Vercel hosting and Vercel Cron for scheduled jobs
- Vitest for unit tests, Playwright for end-to-end tests

## Rules
- Never log or return Plaid access tokens; store them encrypted (AES-256-GCM)
  with the key from env TOKEN_ENCRYPTION_KEY
- Uploaded CSV files are parsed in memory and never stored raw
- All secrets come from env vars; keep .env.example up to date, never commit .env
- Every user-owned table has user_id and is queried through a helper that
  scopes by the signed-in user
- Every sensitive event writes to audit_log; every funnel event to analytics_events
- Detection thresholds and rates live in src/config/detection.ts, never inline
- LLM output never gives investment, tax or legal advice; run it through the
  guardrail check in src/lib/guardrails.ts before display
- Write tests for every rule and every API route you add
- Prefer small, readable modules over clever abstractions
- When unsure about a Plaid field or category name, check the Plaid docs instead
  of guessing

## Commands
- npm run dev / npm test / npm run test:e2e / npm run lint / npx prisma migrate dev
```

## Build steps 1–3: foundation and your own data

Steps 1–3 end with the founders' own bank and card transactions, exported as CSV files, flowing into the database. Plaid waits until step 7.

### Step 1: Scaffold the project (week 1)

> Read CLAUDE.md. Set up the project skeleton for the Financial Controller MVP.
>
> Build:
> 1. A Next.js App Router project in TypeScript (strict), with Tailwind, ESLint
>    and Prettier.
> 2. Prisma connected to Postgres via DATABASE_URL, with an empty initial migration.
> 3. Vitest for unit tests and Playwright for end-to-end tests, each with one
>    passing example test.
> 4. A GitHub Actions workflow that runs lint, unit tests and a secret scan on
>    every push.
> 5. .env.example listing every env var named in CLAUDE.md, with comments.
> 6. src/lib/analytics.ts: a track(userId, name, properties) helper that writes to
>    PostHog and to the analytics_events table (create the table now).
> 7. A landing page at / with one headline ("See how much money you're losing"),
>    a short three-point explainer (read-only access, you approve everything,
>    delete anytime) and a Get started button to /signup. Track landing_viewed
>    and get_started_clicked.
> 8. A /api/health route returning { ok: true }.
>
> Acceptance criteria:
> - npm run dev shows the landing page; npm test and npm run test:e2e pass
> - CI passes on a fresh push
> - No secrets in the repo
>
> Do not build auth, Plaid, or any other feature yet.

### Step 2: Auth, schema and core helpers (week 1–2)

> Read CLAUDE.md. Add authentication, the full database schema, and core helpers.
>
> Build:
> 1. Prisma models for every table in the spec's data model: users, plaid_items,
>    accounts, transactions, recurring_streams, findings, decisions, actions,
>    digests, membership_intents, audit_log, analytics_events. Money as integer
>    cents. Enums for finding type, finding status, action status and decision
>    choice. Cascading deletes from users. Indexes on every user_id and on
>    plaid_transaction_id (unique).
> 2. Auth.js with email magic link (sent through Resend) and Google sign-in.
>    Pages: /signup, /login. Signed-in users land on /import until Plaid arrives in step 7, then on /connect.
> 3. A role field on users (user | admin) and a requireAdmin() server helper.
> 4. src/lib/db-scoped.ts: helpers that always filter by the signed-in user's id.
>    Add a test that one user cannot read another user's rows.
> 5. src/lib/crypto.ts: encrypt/decrypt with AES-256-GCM using
>    TOKEN_ENCRYPTION_KEY. Tests: round trip, tampered ciphertext fails.
> 6. src/lib/audit.ts: logAudit(actor, event, target, metadata).
>    Log sign-up and sign-in.
> 7. Track signup_completed.
>
> Acceptance criteria:
> - I can sign up with a magic link and with Google, sign out, and sign back in
> - Migrations run cleanly on an empty database
> - All tests pass, including the cross-user access test

### Step 3: Import your own data from CSV (week 2)

> Read CLAUDE.md. Let the two founders import their own bank and credit card
> transactions from CSV exports. Plaid comes later (step 7), so build this
> behind a data-source interface that Plaid can plug into without rewrites.
>
> Build:
> 1. src/data-sources/types.ts: a DataSource interface that produces normalized
>    accounts and transactions (date, amount_cents with outflows positive,
>    description, merchant_name, category_primary, category_detailed, account).
>    Add a source field (csv | plaid) to accounts and transactions; make the
>    Plaid-specific columns nullable.
> 2. src/data-sources/csv/: parsers for the export formats of our banks and
>    cards: [list your banks and card issuers here, and attach one sample export
>    from each with real numbers replaced]. Detect the format from the header
>    row; reject unknown formats with a clear message.
> 3. Normalize merchants (strip store numbers, payment-processor prefixes,
>    dates) and dedupe overlapping uploads by account, date, amount and
>    normalized description.
> 4. Categorize every transaction using Plaid's personal finance category
>    taxonomy as our category list, so Plaid data needs no mapping later:
>    keyword rules first, then the LLM for anything unmatched, cached per
>    normalized merchant. Store the category and whether a rule or the LLM set it.
> 5. /import page: pick or create an account (name, type: checking, savings or
>    credit card, current balance entered by hand), upload one or more CSVs,
>    preview parsed rows and any skipped rows with reasons, then confirm.
> 6. Parse files in memory; never store the raw file. Audit-log
>    import_completed with row counts.
> 7. /scanning page that shows progress and moves to /report when processing
>    finishes (detection arrives in step 4; for now just finish).
> 8. Track import_started, import_completed, import_failed.
>
> Acceptance criteria:
> - Importing the same file twice creates no duplicates
> - Unit tests for each bank format, using sanitized fixture files
> - An unknown CSV format fails with a readable error, not a crash
> - Hand-entered balances show on each account (CSV exports usually lack them)

## Build steps 4–6: findings and decisions

Steps 4–6 end with the core product loop working: a user sees their money-found number, opens a card, and says yes or no.

### Step 4: Detection engine (weeks 3–4)

> Read CLAUDE.md and the Detection rules section of the spec (pasted below).
> Build the rule-based detection engine.
>
> [Paste the Detection rules table and bullet list here.]
>
> Build:
> 1. src/config/detection.ts with every threshold and rate as named constants:
>    price-increase threshold (5%), idle-cash multiple (3 months of spending),
>    reference high-yield rate, assumed current rate, lookback window (12 months),
>    minimum confidence for the money-found total.
> 2. src/detection/rules/: one module per finding type (subscription_review,
>    duplicate_subscription, price_increase, bank_fees, idle_cash,
>    insurance_reshop, card_interest). Each takes the user's accounts,
>    transactions and recurring streams and returns candidate findings with
>    title, annual_savings_cents (or null), confidence (low | medium | high)
>    and evidence (transaction ids, amounts, dates).
> 3. Look up the exact Plaid personal finance category names for bank fees,
>    interest charges and insurance in Plaid's docs; put them in the config file.
> 4. Fallback recurring detection when recurring_streams is empty: group outflows
>    by normalized merchant, 3+ charges at a regular interval with amounts
>    within 10%.
> 5. runDetection(userId): runs all rules and upserts findings keyed by
>    (user_id, type, stable key such as merchant or account), updating existing
>    findings instead of duplicating them. Never resurrect a finding the user
>    declined unless its amount changed by more than 20%.
> 6. moneyFound(userId): sums annual_savings_cents for open findings at or above
>    the configured confidence.
> 7. Call runDetection after every CSV import (and every Plaid sync from step 7); mark first detection complete so
>    /scanning can move on.
> 8. Track detection_completed with counts per type and the money-found total.
>
> Acceptance criteria:
> - Unit tests with fixture data for every rule, including no-finding cases
> - Running detection twice produces identical findings
> - No threshold or rate appears outside the config file

### Step 5: LLM explanations and guardrails (week 4)

> Read CLAUDE.md. Add plain-language explanations to each finding using the
> Anthropic SDK, with strict guardrails.
>
> Build:
> 1. src/lib/explain.ts: for a finding, send only what is needed (finding type,
>    merchant names, amounts, dates, the savings estimate). Never send account
>    numbers, names, emails or access tokens.
> 2. Ask for JSON only: { title, explanation (max 2 sentences), give_up (what
>    the user gives up, 1 sentence), alternatives (up to 3 short strings) }.
>    Parse safely; on any failure, fall back to template text per finding type.
> 3. src/lib/guardrails.ts: reject output that (a) recommends specific
>    securities, investments or crypto, (b) gives tax or legal advice,
>    (c) contains a dollar figure that does not match the finding's evidence or
>    estimate, or (d) promises a guaranteed outcome. Rejected output falls back
>    to the template.
> 4. Use the LLM for one classification task too: deciding whether an ambiguous
>    recurring merchant is a subscription. Rules still decide the finding.
> 5. Cache explanations on the finding; regenerate only when its evidence changes.
> 6. Store the model name and prompt version on each explanation for the audit
>    trail.
>
> Acceptance criteria:
> - Tests for each guardrail rule, including a mismatched dollar figure
> - With the API key unset, every finding still shows template text
> - No personal identifiers in any request payload (add a test that inspects it)

### Step 6: Savings report, decision cards and decision log (weeks 4–5)

> Read CLAUDE.md and the Screens and user flow section of the spec. Build the
> savings report and decision cards.
>
> Build:
> 1. /report: headline "We found $X a year" from moneyFound(), then open findings
>    sorted by annual savings (findings without a dollar estimate last). Each
>    row opens a card. Mobile-first layout.
> 2. Decision card (modal or page): what changes, savings per year (marked as an
>    estimate), what you give up, alternatives, the evidence (recent charges with
>    dates), and a referral disclosure line when the action uses a referral
>    partner. Yes and No buttons.
> 3. POST /api/decisions: records the choice with a full JSON snapshot of the
>    card as shown. Yes sets the finding to approved and creates an action with
>    status queued. No sets it to declined, with a 10-second undo.
>    Audit-log both.
> 4. /actions: the user's approved actions with live status and, for
>    waiting_on_user, exactly what they need to do.
> 5. Empty states: no findings yet, and "nothing found" (still show what we
>    checked).
> 6. Track report_viewed, card_opened, decision_yes, decision_no, decision_undone.
>
> Acceptance criteria:
> - End-to-end test: import a fixture CSV -> report -> approve a card -> action
>   appears on /actions with status queued
> - Each decision row holds the exact card text the user saw
> - Works on a 375px-wide screen

## Build steps 7–11: Plaid, operations, retention, revenue, launch

Steps 7–11 end with a beta-ready product: outside users link accounts through Plaid, the team can work the queue, users get a weekly digest and a membership offer, and the security checklist is complete.

### Step 7: Plaid linking and sync, before outside users (weeks 6–7)

> Read CLAUDE.md. Add Plaid as a second data source so beta users can link
> accounts instead of uploading CSVs. Implement the DataSource interface from
> step 3. Use the Plaid Node SDK, Sandbox by default, environment from
> PLAID_ENV. Request the Transactions product only.
>
> Build:
> 1. POST /api/plaid/link-token: creates a link token for the signed-in user with
>    a webhook URL pointing at /api/plaid/webhook.
> 2. POST /api/plaid/exchange: exchanges the public token, stores the item with
>    the access token encrypted, fetches accounts (source plaid), then starts the
>    first sync. Audit-log item_linked.
> 3. A sync function using /transactions/sync with the stored cursor: upsert
>    added and modified transactions, delete removed ones, save the new cursor.
>    Store Plaid's personal finance category (primary and detailed) directly.
> 4. Recurring streams: call /transactions/recurring/get after each sync and
>    upsert recurring_streams. If the endpoint is not enabled for our Plaid
>    account, log a clear warning and skip it; detection falls back.
> 5. POST /api/plaid/webhook: verify the webhook signature per Plaid's docs
>    before doing anything. Handle SYNC_UPDATES_AVAILABLE by running a sync.
>    Handle item errors (e.g. ITEM_LOGIN_REQUIRED) by marking the item status
>    and showing a reconnect prompt using Link update mode.
> 6. /connect page: trust explainer, Plaid Link button, list of linked
>    institutions, "add another account", Continue to the existing /scanning.
>    Keep /import available for founders and admins only.
> 7. Run detection after every sync, exactly as after a CSV import.
> 8. A daily Vercel Cron job that syncs items not updated in 24 hours.
> 9. Track link_started, link_succeeded, link_failed, first_sync_completed.
>
> Acceptance criteria:
> - In Sandbox I can link a test institution and see findings on /report
> - Re-running sync never creates duplicates
> - A forged webhook is rejected
> - Access tokens never appear in logs, API responses or the client bundle
> - Tests cover sync upserts and removals with mocked Plaid responses
> - CSV-imported data for founders keeps working alongside Plaid data

### Step 8: Concierge queue and metrics (weeks 5–6)

> Read CLAUDE.md and the Concierge back office section of the spec (pasted below).
> Build the internal admin tools.
>
> [Paste the Concierge back office table and queue rules here.]
>
> Build:
> 1. /admin, protected by requireAdmin(); every page view of user data writes to
>    audit_log.
> 2. /admin/queue: actions filtered by type and status, oldest first; highlight
>    any queued longer than one business day.
> 3. /admin/actions/[id]: the card snapshot the user approved, the finding's
>    evidence, notes, assignee, status buttons (in_progress, waiting_on_user,
>    done, failed), a required minutes_spent field when closing, and a required
>    reason when failing. For waiting_on_user, a required "what the user needs to
>    do" text shown on their /actions page.
> 4. Status changes update the finding status and email the user via Resend.
> 5. /admin/metrics: every metric in the spec's Success metrics table, computed
>    from analytics_events and the DB, for the last 7 and 30 days, plus minutes
>    per action by type.
> 6. Track action_started, action_waiting, action_done, action_failed.
>
> Acceptance criteria:
> - A non-admin gets a 404 on every /admin route
> - Closing an action without minutes, or failing without a reason, is blocked
> - The user sees each status change on /actions and by email

### Step 9: Weekly digest (week 6)

> Read CLAUDE.md. Build the weekly digest email.
>
> Build:
> 1. A weekly Vercel Cron job (Monday morning, user's timezone if stored, else
>    US Pacific) that builds a digest per active user: saved this week and to
>    date (from done actions), pending actions and what they need from the user,
>    new findings since the last digest, and the money-found total.
> 2. Skip users with nothing new and nothing pending; never send an empty digest.
> 3. Send with Resend using a simple, readable HTML template plus a plain-text
>    version. Links go to the app with UTM parameters.
> 4. Store each digest in digests with its payload; record opens via link clicks
>    (no tracking pixel).
> 5. One-click unsubscribe and an email preferences toggle in /settings.
> 6. Track digest_sent, digest_clicked.
>
> Acceptance criteria:
> - A dry-run mode that renders digests for all users without sending
> - Tests for the skip rule and the totals
> - Unsubscribe works without signing in

### Step 10: Membership willingness-to-pay test (week 6)

> Read CLAUDE.md. Add the membership offer to test willingness to pay. No
> recurring billing yet.
>
> Build:
> 1. After a user's first action reaches done, show a membership offer on
>    /actions and in the next email: "We'll keep doing this for you, ongoing."
>    Include their saved-to-date amount.
> 2. Two buttons: Reserve (free, records intent) and Become a founding member
>    (Stripe Checkout, one-time payment, price from env MEMBERSHIP_TEST_PRICE).
> 3. POST /api/stripe/webhook: verify the Stripe signature; on
>    checkout.session.completed, record a membership_intent of kind paid.
> 4. Show the offer once per user per 14 days; never block any feature behind it.
> 5. Track membership_offer_shown, membership_reserved, membership_checkout_started,
>    membership_paid.
>
> Acceptance criteria:
> - Stripe test-mode payment creates a paid membership_intent
> - A forged Stripe webhook is rejected
> - Users who dismiss the offer don't see it again for 14 days

### Step 11: Beta hardening (weeks 7–8)

> Read CLAUDE.md and the Security and compliance checklist in the spec (pasted
> below). Make the app safe for outside beta users.
>
> [Paste the Security and compliance checklist here.]
>
> Build:
> 1. /settings: list connected institutions with Disconnect (calls /item/remove,
>    deletes that item's data) and Delete all my data (removes every Plaid item,
>    then all user rows; confirm by typing DELETE). Audit-log both.
> 2. A daily cron that removes Plaid items for users inactive 60+ days (value in
>    config) after emailing them 7 days ahead.
> 3. Rate limiting on auth, Plaid and decision routes; security headers (CSP,
>    HSTS); error monitoring with PII scrubbing.
> 4. MFA required for admin accounts.
> 5. Invite codes: sign-up requires a valid code so the beta stays closed.
> 6. A Production switch checklist script that verifies env vars, PLAID_ENV,
>    webhook URLs and Stripe live keys before deploy.
> 7. Go through every checklist item and report which are done in code and which
>    need a human (legal, Plaid questionnaire, backups restore test).
>
> Acceptance criteria:
> - After Delete all my data, no rows for that user remain and Plaid items are
>   removed (verify in Sandbox)
> - Rate limits return 429 under a simple load test
> - A written report of the checklist status

## Open questions

- [ ] Target values for each success metric
- [x] Membership test price, and whether to offer the paid option or reserve only: $49 one-time (MEMBERSHIP_TEST_PRICE); Reserve only until Stripe keys are added
- [ ] Which insurance marketplace and high-yield account to use as referral partners
- [x] Is Plaid's recurring transactions endpoint enabled on our plan, or do we rely on the fallback detector? It works in Sandbox; the fallback covers any account without streams, so either way is fine
- [ ] Launch state, for the insurance referral licensing question
- [ ] Who on the team owns the concierge queue and its one-business-day turnaround?

# Beyond the MVP: building the full financial controller

The MVP proves people will link accounts and say yes. The full Jane is a financial controller: it watches everything, explains it plainly, finds every leak, and handles the fixes, first with the concierge team, then with automation. These steps continue the numbering and keep the same rules and workflow as steps 1–11.

Principles that still hold:

- **Read-only until counsel says otherwise.** No money movement, investing, investment advice, or tax and legal advice. Phase P lists what needs licenses; it goes through licensed partners, built against their sandboxes, and doesn't go live until the partner and counsel sign off.
- **Rules decide, the LLM explains.** Every new finding type is a tested rule with thresholds in config; Claude only writes text and classifies edge cases, behind the guardrails.
- **Every step is shippable alone.** One PR per step, tests for every rule and route, and nothing that blocks on an outside account: when a step needs one, build a working stand-in and note what to swap in later.
- **Measure, then automate.** Minutes per action decide which concierge work to automate first.

## Phase A: beta-ready polish (steps 12–14)

### Step 12: Legal pages and consent

> Read CLAUDE.md and docs/beta-checklist.md. Add the legal pages and record consent.
>
> Build:
> 1. /privacy, /terms and /security pages written from the facts in
>    docs/beta-checklist.md (data read, what's shared with Claude, retention,
>    deletion, no tracking pixels). Show a "Draft, pending legal review" banner
>    unless env LEGAL_REVIEWED is "true".
> 2. Footer links to all three on every page.
> 3. Sign-up requires ticking "I agree to the Terms and Privacy Policy"; store the
>    accepted terms version and time on the user and audit-log it.
> 4. When the terms version changes, existing users accept the new version once
>    before continuing.
>
> Acceptance criteria:
> - Sign-up is refused without consent; the accepted version is stored
> - A terms version bump asks existing users once, then never again
> - Pages render at 375px and pass the existing CSP

### Step 13: Home dashboard

> Read CLAUDE.md. Give linked users a home page that answers "how am I doing?"
>
> Build:
> 1. /home: money found, saved to date, actions waiting on you, newest findings,
>    the next few upcoming charges, and when data was last updated.
> 2. Sign-in lands on /home once a person has any account; /connect otherwise.
> 3. Empty and loading states that never show a blank page.
>
> Acceptance criteria:
> - New users land on /connect, linked users on /home (e2e)
> - Every number on /home matches the report and actions pages
> - Works at 375px

### Step 14: Your data: freshness and export

> Read CLAUDE.md. Let people see how fresh their data is and take it with them.
>
> Build:
> 1. On /settings, each account with its balance, last update and source.
> 2. "Refresh now" for linked banks (runs a sync), rate limited.
> 3. "Download my data": a JSON file with every row the app holds for the person
>    (accounts, transactions, findings, decisions, actions, digests, settings),
>    never another person's, never tokens. Audit-log each export.
>
> Acceptance criteria:
> - The export contains every user-owned table and nothing from other users
> - Access tokens and secrets never appear in the export (test)
> - Refresh is rate limited

## Phase B: see everything (steps 15–17)

### Step 15: Spending insights

> Read CLAUDE.md. Show where money goes, without budgets or advice.
>
> Build:
> 1. src/insights: pure functions for spending by category per month, top
>    merchants, income versus spending, and month-over-month changes. Transfers,
>    card payments and refunds are handled so nothing is counted twice.
> 2. /insights with simple accessible charts (inline SVG, text alternatives) and
>    a 12-month range.
> 3. Track insights_viewed.
>
> Acceptance criteria:
> - Totals reconcile exactly with the transactions they come from (tests)
> - Card payments and transfers between the person's own accounts aren't spending
> - Charts have text equivalents and work at 375px

### Step 16: Upcoming bills and cash-flow forecast

> Read CLAUDE.md. Predict what's coming out of the person's accounts.
>
> Build:
> 1. Next expected date and amount for every active recurring stream (Plaid's
>    predicted date when present, our cadence otherwise).
> 2. A 30-day forecast for each checking account: today's balance, minus
>    upcoming bills, plus expected recurring income.
> 3. A new finding type, low_balance_risk (no dollar estimate), when the
>    forecast dips below a configured cushion before the next income.
> 4. /bills: a calendar-style list of the next 30 days.
>
> Acceptance criteria:
> - Forecast tests with fixed fixtures, including irregular income
> - low_balance_risk is created and cleared by rescans like other findings
> - Thresholds live in config

### Step 17: Alerts

> Read CLAUDE.md. Tell people when something needs their attention.
>
> Build:
> 1. An alerts table and engine run after every sync or import: new
>    subscription, price increase, fee charged, unusually large charge, possible
>    duplicate charge, low balance ahead.
> 2. /alerts in the app; urgent alerts by email right away (at most a configured
>    number per day), the rest in the weekly digest.
> 3. Per-type preferences on /settings.
> 4. Each alert is raised once per event, never repeated by a rescan.
>
> Acceptance criteria:
> - A test per alert rule, including the no-alert case
> - Preferences are respected; the daily email cap holds
> - Rescans never duplicate an alert

## Phase C: more ways to save (steps 18–20)

### Step 18: Refunds and disputes

> Read CLAUDE.md. Find money people are owed back.
>
> Build:
> 1. New finding types: duplicate_charge (same merchant and amount within a
>    configured number of days), charge_after_cancel (a charge from a merchant
>    whose cancellation action is done), trial_conversion (a first full charge
>    after a $0 or $1 charge).
> 2. A new action type, request_refund, with team playbook text.
> 3. Thresholds in src/config/detection.ts.
>
> Acceptance criteria:
> - Rule tests with fixtures, including look-alikes that must not match
> - Money found counts refunds only at medium confidence or above

### Step 19: Bill negotiation

> Read CLAUDE.md. Spot bills that are usually negotiable and priced high.
>
> Build:
> 1. A bill_negotiation finding for phone, internet, TV and insurance bills
>    above benchmark ranges in config (labelled as estimates, with the source of
>    each range noted in config).
> 2. A negotiate_bill action type for the concierge, with a script.
>
> Acceptance criteria:
> - Rule tests at, below and above each benchmark
> - Cards say "typical price" and never promise a result (guardrails)

### Step 20: Debt payoff planner (education, not advice)

> Read CLAUDE.md. Help people see what card interest costs over time.
>
> Build:
> 1. A calculator for credit cards: balances from the person's accounts, APR
>    and minimum payment entered by them. Show avalanche and snowball schedules
>    side by side with total interest and payoff dates.
> 2. Plain disclaimer: math, not a recommendation; guardrails on any LLM text.
> 3. Link from card_interest findings.
>
> Acceptance criteria:
> - Schedule math matches hand-checked examples to the cent
> - No wording that recommends a choice (guardrail tests)

## Phase D: Jane does more for you (steps 21–24)

### Step 21: Team playbooks and drafted messages

> Read CLAUDE.md. Make each concierge action faster.
>
> Build:
> 1. A playbook per action type on the admin action page: steps, what to ask the
>    person for, and how to close.
> 2. A Claude-drafted merchant email or call script for the action (guardrailed,
>    only the details the merchant needs), with a copy button.
> 3. "Automate next" on /admin/metrics: action types ranked by approvals ×
>    minutes per action.
>
> Acceptance criteria:
> - Drafts never include data the merchant doesn't need (payload test)
> - The ranking matches hand-computed fixtures

### Step 22: Do-it-yourself kits

> Read CLAUDE.md. Let people fix things themselves when that's quicker.
>
> Build:
> 1. On decision cards for supported actions, a "Do it myself" option: the
>    merchant's cancel or support link, steps, and a pre-written email (mailto).
> 2. The person marks it done; it counts as saved like a team action.
> 3. Track diy_started and diy_done.
>
> Acceptance criteria:
> - "Do it myself" never creates a concierge action
> - Savings from DIY count once in saved-to-date

### Step 23: Ask Jane

> Read CLAUDE.md. Let people ask questions about their own money.
>
> Build:
> 1. /ask: a chat with Claude using read-only, user-scoped tools (search
>    transactions, spending by category, list findings and actions, upcoming
>    bills). Streaming answers.
> 2. Every answer goes through the guardrails; no advice, no invented numbers
>    (figures must come from tool results).
> 3. Conversations stored per user, deletable, included in data export and
>    "Delete all my data". Rate limited.
>
> Acceptance criteria:
> - Tools can only read the signed-in person's data (tests)
> - A figure not in any tool result is caught by the guardrails
> - Conversations are removed by "Delete all my data"

### Step 24: Merchant directory

> Read CLAUDE.md. Build shared knowledge about merchants.
>
> Build:
> 1. A merchants table (not user data): canonical name, aliases, cancel URL,
>    support contact, category, typical prices. Admin-editable at /admin/merchants.
> 2. Used by DIY kits, playbooks, detection (better merchant matching) and cards.
> 3. Seed it with the most common subscriptions.
>
> Acceptance criteria:
> - No personal data in the merchants table (schema review and test)
> - Merchant matching improves on the existing fixtures without regressions

## Phase E: grow (steps 25–27)

### Step 25: Household sharing

> Read CLAUDE.md. Let partners see shared money.
>
> Build:
> 1. Invite a partner to a household; each person chooses which accounts to share.
> 2. Partners see shared accounts' findings; decisions stay per person.
> 3. Scoping helper extended so shared rows are readable, never writable, by the partner.
>
> Acceptance criteria:
> - A partner can't see unshared accounts or the other person's decisions (tests)
> - Leaving a household removes access immediately

### Step 26: Installable app and notifications

> Read CLAUDE.md. Make Jane feel like an app on phones.
>
> Build:
> 1. A web app manifest, icons and an offline page (PWA).
> 2. Web push for urgent alerts when VAPID keys are set; email otherwise.
>
> Acceptance criteria:
> - Lighthouse PWA checks pass
> - Push is optional and off without keys

### Step 27: Partner referrals

> Read CLAUDE.md. Turn referral partners on safely.
>
> Build:
> 1. Partner records with disclosure text, referral links and states where each
>    is allowed; cards show the disclosure word for word.
> 2. Conversion tracking (webhook or manual entry) and referral revenue in metrics.
> 3. Insurance referrals stay off until counsel's answer is recorded in config.
>
> Acceptance criteria:
> - No card with a partner action renders without its disclosure (test)
> - A partner can be turned off instantly

## Phase G: plan and track (steps 28–32)

Phases A–E find money and fix it. Phase G helps people plan: their own categories, budgets, goals, net worth and reminders. All of it is the person's own numbers and plain math; none of it is advice.

### Step 28: Category corrections

> Read CLAUDE.md. Let people fix a wrong category, once.
>
> Build:
> 1. On /insights (and a transaction list), change a transaction's category.
> 2. Offer "always for this merchant": a per-person merchant rule applied to past
>    and future transactions, ahead of Plaid's and Claude's categories.
> 3. Insights, detection and Ask Jane use the corrected category.
>
> Acceptance criteria:
> - A correction survives the next sync or import (tests)
> - A merchant rule never touches another person's transactions

### Step 29: Budgets

> Read CLAUDE.md. A monthly limit per category, if the person wants one.
>
> Build:
> 1. Budgets per spending category, with a suggested amount from the last three
>    months (shown as a suggestion, never a recommendation).
> 2. Progress on /insights and Home: spent, left, and days left in the month.
> 3. A non-urgent "over budget" alert, once per category per month, respecting
>    alert preferences.
>
> Acceptance criteria:
> - Totals match /insights exactly (same rules for transfers and refunds)
> - The over-budget alert is raised once per category per month

### Step 30: Savings goals

> Read CLAUDE.md. Track progress toward a goal the person sets.
>
> Build:
> 1. Goals with a name, target amount and date, optionally tied to a savings
>    account's balance (or updated by hand).
> 2. Progress and the monthly amount needed to reach the target by the date:
>    math only, with the same "not a recommendation" wording as the debt planner.
>
> Acceptance criteria:
> - Monthly-needed math matches hand-checked examples to the cent
> - Goal wording passes the recommendation guardrail

### Step 31: Net worth over time

> Read CLAUDE.md. Show where the person stands and how it's moving.
>
> Build:
> 1. A daily balance snapshot per account (cron), kept for two years.
> 2. /net-worth: assets minus debts today, and a monthly chart, with a note on
>    which accounts are included and which have no balance.
>
> Acceptance criteria:
> - Snapshots are idempotent per account per day
> - Credit card balances count as debts; accounts without balances are left out
>   and listed

### Step 32: Bill reminders

> Read CLAUDE.md. Remind people before a bill they can't afford to miss.
>
> Build:
> 1. A "bill due soon" alert a configured number of days before an expected bill
>    (from the forecast), urgent only when the account is forecast to be short.
> 2. Per-type preferences and the daily cap from step 17 apply.
>
> Acceptance criteria:
> - One reminder per bill per due date, even across rescans
> - Urgent only when the forecast balance on the due date is below the cushion

## Phase H: trust and scale (steps 33–35)

### Step 33: Accessibility

> Read CLAUDE.md. Make every page usable with a keyboard and a screen reader.
>
> Build:
> 1. Automated axe checks in the end-to-end tests on every page, signed in and out.
> 2. Fix what they find: labels, contrast, focus order, headings.
>
> Acceptance criteria:
> - No serious or critical axe violations on any page

### Step 34: Metrics at scale

> Read CLAUDE.md. Keep the team's pages fast as people join.
>
> Build:
> 1. Move /admin/metrics to SQL aggregates instead of loading every row.
> 2. A small job table for slow work (explanations, digests) with retries.
>
> Acceptance criteria:
> - The SQL numbers match the current pure functions on the test fixtures
> - A failed job retries with backoff and is visible on an admin page

### Step 35: Year in review

> Read CLAUDE.md. A once-a-year look back the person can keep.
>
> Build:
> 1. /year: spending by category and month, what Jane found, what was saved
>    (team and do-it-yourself), and the biggest changes from last year.
> 2. A printable layout.
>
> Acceptance criteria:
> - Every figure matches the insights and saved-to-date numbers for that year

## Phase I: everything in one place (steps 36–40)

Phase I brings in the rest of a person's money picture without new regulated work: every subscription and renewal, more ways to get data in, a calendar they already use, and a weekly email that reflects their plans.

### Step 36: Subscriptions and renewals

> Read CLAUDE.md. One list of everything that renews.
>
> Build:
> 1. /subscriptions: every recurring charge we see, with frequency, last and next
>    charge, and yearly cost; quick links to the card or do-it-yourself kit.
> 2. A "renews soon" alert a configured number of days before a yearly or
>    quarterly renewal, once per renewal.
>
> Acceptance criteria:
> - Totals match the subscription findings and forecast
> - One alert per renewal date; monthly charges never trigger it

### Step 37: OFX and QFX import

> Read CLAUDE.md. Let people bring files from any bank.
>
> Build:
> 1. Import .ofx and .qfx (the formats most banks offer besides CSV) through the
>    same DataSource interface and dedupe rules as CSV.
> 2. Parsed in memory, never stored raw (same rule as CSV).
>
> Acceptance criteria:
> - Fixture files from two OFX dialects (SGML 1.x and XML 2.x) import correctly
> - Re-importing the same file adds nothing

### Step 38: Money calendar feed

> Read CLAUDE.md. Put bills and paydays in the calendar the person already uses.
>
> Build:
> 1. A private calendar feed (iCalendar) of expected bills, paydays, goal dates and
>    renewals, behind a secret link the person can reset.
> 2. Settings: copy the link, reset it, turn it off.
>
> Acceptance criteria:
> - The feed holds no account names or numbers, and an old link stops working the
>   moment it's reset
> - Events are stable across refreshes (same UID for the same bill)

### Step 39: A weekly email about your plans

> Read CLAUDE.md. Make the digest reflect budgets, goals and net worth.
>
> Build:
> 1. Digest sections for budgets (over or close), goals (progress since last
>    week) and net worth change, only when the person uses those features.
> 2. Still never sent empty.
>
> Acceptance criteria:
> - Each section appears only with data, and its numbers match the pages

### Step 40: Smarter merchant directory

> Read CLAUDE.md. Learn from what the team does.
>
> Build:
> 1. Per merchant: how often cancellations and refunds succeed and how long they
>    take, from finished actions (aggregated, no personal data).
> 2. Shown to the team on actions and to people on do-it-yourself kits ("usually
>    takes about 10 minutes") once there are enough cases.
>
> Acceptance criteria:
> - Nothing is shown below a configured minimum number of cases
> - The aggregates hold no user ids

## Phase J: running the service (steps 41–43)

### Step 41: Team workload

> Read CLAUDE.md. Help the concierge team share the queue.
>
> Build:
> 1. Assign actions to team members, filter by assignee, and see each person's
>    open work and overdue items.
> 2. Saved replies for common updates to the person.
>
> Acceptance criteria:
> - Assignment and saved replies are audit-logged
> - Overdue uses the same business-day rule as the queue

### Step 42: Health checks

> Read CLAUDE.md. Know when something quietly stops.
>
> Build:
> 1. Record each cron run and Plaid sync; /admin/health shows the last run of
>    each, failed jobs and error counts.
> 2. Email the team when a daily job hasn't run for over a day.
>
> Acceptance criteria:
> - A missed run is reported once, not every hour
> - Health pages are admin-only and audit-logged

### Step 43: Data retention

> Read CLAUDE.md. Keep only what's needed.
>
> Build:
> 1. Scheduled deletion of old analytics events, rate-limit rows, finished jobs and
>    stale sessions, by periods in config.
> 2. The privacy policy's retention section generated from the same config.
>
> Acceptance criteria:
> - Each kind of data is removed after its period, and nothing younger is touched
> - The policy text and the config can't disagree (test)

## Phase K: Jane looks ahead (steps 44–47)

Phase K turns everything Jane knows into a few clear numbers and nudges, still as plain math and the person's own data, never advice.

### Step 44: Safe to spend until payday

> Read CLAUDE.md. One number: what's left once bills and plans are covered.
>
> Build:
> 1. On Home: checking balance today, minus bills expected before the next deposit,
>    minus what's left in budgets and goal amounts for the period (each shown), equals
>    "safe to spend until <date>".
> 2. Every part can be expanded; nothing is hidden in the number.
>
> Acceptance criteria:
> - The number reconciles exactly with the forecast, budgets and goals pages
> - With no deposit expected, it says so instead of guessing a date

### Step 45: Monthly check-in

> Read CLAUDE.md. Once a month, the whole picture in two minutes.
>
> Build:
> 1. /check-in for the month just ended: spending vs the month before, budgets kept,
>    goals moved, net worth change, what Jane found and what got done.
> 2. A short summary written by Claude from those figures only, through the
>    guardrails, with a template fallback; an email on the first of the month.
>
> Acceptance criteria:
> - Every figure matches its page; the summary uses no figure that isn't in the data
> - The email respects the digest preference and is never empty

### Step 46: Shared bills in a household

> Read CLAUDE.md. Who paid what, and who owes whom.
>
> Build:
> 1. In a household, mark a charge on a shared account as shared (with a split).
> 2. A running balance between the two people, and "settle up" to zero it.
>
> Acceptance criteria:
> - Only charges on shared accounts can be split; each person sees the same balance
> - Leaving the household keeps each person's own history but ends the shared balance

### Step 47: First week with Jane

> Read CLAUDE.md. Help new people get to their first saving.
>
> Build:
> 1. A checklist on Home for the first weeks: link a bank, review three cards, set a
>    budget or goal, turn on alerts; it disappears when done or dismissed.
> 2. Funnel events for each item.
>
> Acceptance criteria:
> - Items tick themselves from real state, not clicks on the checklist
> - Dismissing hides it for good

## Phase M: Jane acts for you (steps 49–56)

Top priority (reordered Oct 18, 2026). Competitors already find subscriptions and have a
team negotiate bills; Rocket Money's Rowan agent (Aug 2026) acts on a one-word reply for
subscriptions, bills and savings. Jane stands out by acting on everything it finds
(refunds, fees, insurance, interest, deadlines), never taking a cut of savings, and
letting people set their own rules. The goal of this phase: the agent proposes and does
the work; the person says yes, no or change; the team handles only what the agent hands
off.

Ground rules for every step in this phase:
- Nothing happens without a yes, either from the person or from a standing rule they set.
- The agent never asks for, stores or uses the person's passwords for other services.
  When a company insists the account holder acts, Jane prepares everything and sends the
  person a one-tap step.
- Every message the agent writes passes the guardrails and is kept in the action's
  timeline; every agent step writes to audit_log.
- No money movement and no investment, tax or legal advice (Phase P covers partners).

### Step 49: Jane's plan

> Read CLAUDE.md. One list of what Jane proposes to do, instead of a pile of cards.
>
> Build:
> 1. /plan: the open findings turned into proposed actions, ranked by money and urgency,
>    each with what Jane will do, what it saves and the evidence (the card's content).
> 2. Yes / No / Change on each item, and "Yes to all". Change edits the action's options
>    (for example cancel or downgrade, the price to ask for, which account).
> 3. A new plan each week: in the weekly email and as a notification, linking to /plan.
>
> Acceptance criteria:
> - Each item maps to one finding; every answer is logged in the decision log, one decision
>   per item for "Yes to all"
> - Changed options are stored with the decision and used by whoever does the action
> - Items already decided or snoozed don't come back until the finding changes

### Step 50: Standing rules

> Read CLAUDE.md. Let people pre-approve the small things.
>
> Build:
> 1. Rules in Settings, chosen from a fixed list (for example: always request refunds for
>    double charges; always dispute bank fees; cancel subscriptions I mark unused; fight
>    price increases under an amount I choose), each with a monthly limit.
> 2. A matching plan item is approved by the rule: logged as a decision made by that rule,
>    with a notification and the usual undo window.
>
> Acceptance criteria:
> - A rule only approves items it matches (a test per rule)
> - Turning a rule off stops it at once; rules never approve money movement or phone calls
> - Rules live in config (src/config/rules.ts), never inline

### Step 51: The action agent

> Read CLAUDE.md. Approved actions are worked by an agent, not a person.
>
> Build:
> 1. An agent run per approved action: its playbook (src/config/playbooks.ts) becomes
>    steps the agent takes; state is kept on the action with a timeline.
> 2. The first channel is email: the agent writes to the company's support address (from
>    the merchant directory) from a Jane address, stating it acts on the person's behalf,
>    and reads replies (inbound email webhook, parsed by Claude into a status).
> 3. Follow-ups on a schedule; when stuck (needs a login, a phone call, an ID check) it
>    hands the action to the team queue or asks the person for a one-tap step, with the
>    reason.
> 4. Without email keys, a simulated company mailbox in development answers like a real
>    support team, so the whole loop runs and is tested.
>
> Acceptance criteria:
> - Every outgoing message passes the guardrails and appears in the timeline
> - The team queue shows only handed-off actions, each with why
> - An agent can't act on an action that isn't approved (test against every status)

### Step 52: Refunds and fees, done by the agent

> Read CLAUDE.md. The first actions the agent finishes alone.
>
> Build:
> 1. Agent playbooks for double charges, charges after cancelling, trial conversions and
>    bank fee refunds: the request, follow-ups, and what counts as success.
> 2. Success measured from the transactions (a refund or reversal appears) as well as
>    replies; results feed the merchant outcomes.
>
> Acceptance criteria:
> - An action is "done" only when a refund or a written confirmation is seen
> - Money saved counts only confirmed refunds

### Step 53: Cancellations and price fights, done by the agent

> Read CLAUDE.md. Subscriptions without a phone call.
>
> Build:
> 1. Cancellation through the merchant's channel from the directory (email, or a one-tap
>    link for the person where the company requires it), and price-increase requests.
> 2. Confirmation: the reply, then no further charge; the charge-after-cancel rule is the
>    safety net.
>
> Acceptance criteria:
> - A cancellation is confirmed only by a reply or a missed charge, never assumed
> - A charge after a confirmed cancel opens a refund action automatically

### Step 54: Phone negotiation

> Read CLAUDE.md. Bills and insurance that need a call.
>
> Build:
> 1. A voice provider behind an interface (src/lib/voice), with a simulated call in
>    development; the real provider switches on with its keys.
> 2. The call script comes from the playbook: who Jane is, the person's authorization,
>    the target price from the bill benchmarks; the transcript and outcome are stored.
>
> Acceptance criteria:
> - Calls happen only with an explicit yes for that bill (no standing rule can approve one)
> - The person sees the transcript; claims in the script pass the guardrails

### Step 55: Jane drafts budgets and goals

> Read CLAUDE.md. Less setting up.
>
> Build:
> 1. Proposed budgets from the person's own spending and an emergency-fund goal from three
>    months of spending, as plan items (Yes / No / Change).
> 2. Uncategorized merchants get a proposed category in the plan as well.
>
> Acceptance criteria:
> - Nothing is created until the person says yes
> - Proposals are math from their data, labelled as such, never advice

### Step 56: What Jane did

> Read CLAUDE.md. Show the work.
>
> Build:
> 1. Each action's timeline in plain words: what Jane sent, what came back, what's next.
> 2. A weekly "what Jane did for you" section in the weekly email and on Home: actions
>    finished, money confirmed saved, what's waiting on the person.
>
> Acceptance criteria:
> - Every agent step appears in the timeline
> - Money figures come only from confirmed outcomes

## Phase Q: Autopilot (steps 57–64)

Top priority (Oct 18, 2026). Jane decides on its own whenever an action can't hurt the
person and can be undone, and stops them only when they could lose money, get locked into
something, or Jane truly doesn't know. Moving money, contracts or fees, cancelling things
they may use, and account-holder-only steps always need them. Every automatic step is on
the timeline and can be taken back.

### Step 57: Autopilot levels

> Read CLAUDE.md. One choice instead of rule-by-rule settings.
>
> Build:
> 1. Three levels: Ask me first; Handle the safe stuff (recommended); Handle everything
>    allowed. Each sets the standing rules (src/config/autopilot.ts); fine-tuning rules by
>    hand makes it "custom".
> 2. A one-tap chooser on Home and the plan until the person picks; picking applies the
>    rules at once.
>
> Acceptance criteria:
> - No level ever approves moving money, calls, cancellations or insurance
> - Picking a level approves matching open items straight away, each one undoable

### Step 58: Jane answers companies' questions itself

> Read CLAUDE.md. Only ask the person what Jane can't know.
>
> Build:
> 1. When a company asks for a detail Jane already has (last 4 digits of the card from the
>    account, the account email, charge dates and amounts, the account holder's name), the
>    agent answers on its own.
> 2. Everything else still goes to the person.
>
> Acceptance criteria:
> - Never a full card or account number, a password, or anything not in the person's data
> - Each automatic answer is on the timeline

### Step 59: One tap for the whole week

> Read CLAUDE.md. The plan arrives decided.
>
> Build:
> 1. Jane pre-selects the items it would do; one "Go ahead" approves them, and the person
>    unticks what they don't want.
>
> Acceptance criteria:
> - One decision per item, as with "Yes to all"; unticked items stay on the plan

### Step 60: Approve from email or phone

> Read CLAUDE.md. No app needed for a quick yes.
>
> Build:
> 1. Signed one-tap links in the weekly email and notifications: "Go ahead with this
>    week's plan" and "Take it back".
>
> Acceptance criteria:
> - Links expire, work once, and only for that person and those items
> - Never for anything that needs a contract, a call or money movement

### Step 61: Cancellations confirm themselves

> Read CLAUDE.md. "I've cancelled it" becomes optional.
>
> Build:
> 1. After the company's cancel page is offered, Jane watches for the next charge anyway;
>    no charge by the due date closes it without the person telling Jane.
>
> Acceptance criteria:
> - A charge after the due date still goes to the person

### Step 62: Call offers within your limits

> Read CLAUDE.md. Fewer offers to answer.
>
> Build:
> 1. A limit the person sets once (e.g. accept any lower price with no contract and no
>    fee); offers inside it are accepted on the call.
>
> Acceptance criteria:
> - Anything with a contract or a fee still comes to the person

### Step 63: Set-up done for you

> Read CLAUDE.md. Harmless set-up just happens.
>
> Build:
> 1. Categories from the merchant directory are applied automatically (undoable).
> 2. Budgets and the emergency fund are one "Use Jane's suggestions" tap.
>
> Acceptance criteria:
> - Nothing that changes money is applied without a yes

### Step 64: Jane finds support contacts

> Read CLAUDE.md. Less waiting on the team.
>
> Build:
> 1. When a company's support email is missing, the agent looks it up on the company's own
>    site (Claude's web search) and the team confirms it once on /admin/merchants.
>
> Acceptance criteria:
> - Only addresses found on the company's own domain; never used before the team confirms

## Phase R: the best option, chosen for you (steps 75–77)

Top priority (Oct 18, 2026), built before the rest of Phase N. Instead of only saying how
much could be saved, Jane compares the real alternatives, picks the best one for this
person, and switches with one yes. Until Plaid keys are in place, a demo bank stands in for
Plaid so every feature can be used end to end.

### Step 75: Demo bank

> Read CLAUDE.md. A placeholder for Plaid while there are no keys: "Link a demo bank" on
> /connect creates a fake item with checking, savings, a credit card, a mortgage, a student
> loan and a car loan, a year of realistic transactions (subscriptions, bills, fees, a
> price rise, a duplicate charge) and loan details, through the same sync path as Plaid.
>
> Acceptance criteria:
> - Shown only when Plaid isn't set up and outside production, unless DEMO_BANK=1
> - Every screen labels demo data as fake; removing the demo bank removes all of it
> - Detection, the plan, loans, net worth and the agent all work on it unchanged

### Step 76: The best option for you

> Read CLAUDE.md. For a bill, a subscription or idle cash, Jane compares the options it
> knows (a cheaper tier of the same service, other providers' plans, savings accounts) and
> picks the best one for this person: the lowest yearly cost that keeps what they use
> now. The card shows the pick, the yearly saving and the runners-up; yes, no, or pick
> another.
>
> Build:
> 1. A catalog of options (switch_options), kept by the team on /admin/options with a
>    source link and the date it was checked; demo options only outside production.
> 2. A pure comparison (src/planning/compare.ts): what each option would cost this person a
>    year, what they'd give up, and the pick with the reasons.
>
> Acceptance criteria:
> - Only reviewed options in production; prices older than OPTION_STALE_DAYS aren't shown
> - Never insurance or investments (those go through licensed partners, Phase P); the
>   guardrails check every sentence
> - "Best" always means cheapest for the same service, and the card says so

### Step 77: Jane switches for you

> Read CLAUDE.md. A yes on the pick becomes one action: Jane gives the sign-up link (or
> asks the company to change the plan), watches for the new charge, and only then cancels
> the old one, so the person is never without the service.
>
> Acceptance criteria:
> - The old service is cancelled only after the new one is seen on the account
> - Saving is counted from what the new charges actually are

## Phase N: the complete picture (steps 65–68)

### Step 65: Loans and mortgage

> Read CLAUDE.md. Plaid Liabilities (read-only): student, auto and mortgage balances,
> rates and due dates. The debt planner and net worth fill in by themselves.
>
> Acceptance criteria:
> - Rates and balances come from Plaid, never typed guesses; check the Plaid docs for fields

### Step 66: Investment and retirement balances

> Read CLAUDE.md. Plaid Investments balances only, for net worth. No holdings advice, no
> performance commentary.
>
> Acceptance criteria:
> - The guardrails reject any text about what to buy, sell or hold

### Step 67: Things you own

> Read CLAUDE.md. Home and car values entered by hand (with the date), in net worth.

### Step 68: Insurance policies and documents

> Read CLAUDE.md. Upload policies, warranties and receipts; Jane reads the key facts
> (coverage, renewal date, price) into the insurance reshop and deadlines. Files are
> encrypted at rest and covered by export and deletion.

## Phase O: plan ahead (steps 69–72)

### Step 69: Can I afford this?

> Read CLAUDE.md. Enter a purchase or a monthly change; see its effect on safe to spend,
> goals and the next 12 months. Math, not advice.

### Step 70: Saving for irregular costs

> Read CLAUDE.md. Yearly and irregular bills (car, holidays, annual subscriptions) become a
> monthly amount to set aside, shown in budgets and safe to spend.

### Step 71: Deadlines

> Read CLAUDE.md. Return windows, warranties, card benefits, FSA deadlines and renewals in
> one list, with reminders, from transactions and uploaded documents.

### Step 72: Life events and tax-time pack

> Read CLAUDE.md. Checklists for moving, a new job, a new baby; a tax-time pack of
> charity receipts, deductible-looking spending and estimated-tax reminders. Organizing
> only: no tax advice.

## Phase L: your account, your control (steps 48, 73–74)

Step 48 shipped before Phase M; 73 and 74 come after Phases Q, N and O.

### Step 48: Two-factor for everyone

> Read CLAUDE.md. Optional extra protection for people's accounts.
>
> Build:
> 1. Anyone can turn on an authenticator app (the team's TOTP code), with backup
>    codes; sign-in asks for it once per session.
> 2. Turning it off needs a current code.
>
> Acceptance criteria:
> - Backup codes work once each and are stored hashed
> - The admin rule (two-factor always) is unchanged

### Step 73: Devices and sessions

> Read CLAUDE.md. See where you're signed in, and sign out elsewhere.
>
> Build:
> 1. Settings lists active sessions (device type, approximate time, this one marked).
> 2. "Sign out other devices" and per-session sign-out.
>
> Acceptance criteria:
> - Signed-out sessions stop working at once
> - Session tokens never reach the page

### Step 74: Who saw my data

> Read CLAUDE.md. Make the team's access visible to the person.
>
> Build:
> 1. A "Team access" page listing when the concierge team or the agent viewed or acted
>    on the person's data (from the audit log): date, what, and why (the action).
> 2. Included in "Download my data".
>
> Acceptance criteria:
> - Only the person's own entries; team members shown by role, not name
> - Every team view of their data appears (test against the audit events)

## Phase P: regulated features through partners

Licensed partners hold the license and move the money; Jane connects through their APIs.
Each integration is built and tested against the partner's sandbox behind a switch, like
the membership checkout stand-in. Going live needs the company to sign up with the
partner, pass its review, and add the keys; counsel reviews the disclosures and contract.
Check each partner's current docs and terms before building.

| Capability | Kind of partner (examples) | What stays with Jane |
| --- | --- | --- |
| Paying cards and bills, moving idle cash | Money-movement APIs (Plaid Transfer, Method, Dwolla, Moov) | Every payment needs an explicit yes; limits; disclosures |
| Credit score and report | Embedded credit APIs (Array, Spinwheel) | FCRA permissible purpose; how the data is used |
| Tax filing | Embedded tax filing (Column Tax, April) | No tax advice from Jane itself |
| Investing | Brokerage APIs plus a registered adviser partner (Alpaca, DriveWealth) | Recommendations come from the partner's adviser, never from Jane |

Order: card and bill payments first (they act on findings Jane already makes), then
credit score, tax filing, investing last.

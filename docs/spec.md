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

## Status (Oct 19, 2026, morning)

Steps 1–63 are built (24 came before 22, because do-it-yourself kits need its cancel links). On Oct 18, 2026 the roadmap was reordered: Phase M (Jane acts for you, steps 49–56), then Phase Q (Autopilot, steps 57–64), Phase N (the complete picture, 65–68), Phase O (plan ahead, 69–72), the rest of Phase L (73–74) and Phase P (regulated features through partners), which replaces the old Phase F. On Oct 19, 2026, after step 86, the founder's plan was added and deepened, sector by sector: Phase V (a professional chat, steps 87–96), Phase W (Jane does the thinking, 97–101, with demo advice mode as step 98), Phase X (insurance, 102–108), Phase Y (loans and debt, 109–117), Phase Z (taxes, 118–127), Phase AA (investments, 128–137) and Phase AB (show Jane to more people, 138–140), then Phase AC (Jane runs the money, 141–148: one autopilot, a nightly controller run, one ranked list, money and bills that move themselves through stand-ins, a health score, fewer asks and a monthly report). Every step is automation-first and built into Jane's chat in the same step; anything needing an outside account is a stand-in; advice runs on demo data only until licensed partners and counsel sign off. Steps are built in parallel lanes, one per sector, each lane's steps in order. Production deploys only when the founder asks (automatic Vercel deploys are off: the free plan allows 100 a day). Where the build differs from the original plan, the plan below has been kept and the difference is noted here.

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
| 67 Things you own | PR #82 | New /things page (linked from Home, /net-worth and /loans) where the person enters their home, car or anything else of value by hand: a kind, a name, what it's worth and the date of that value (today by default, never in the future, at most $20 million as a typo guard), with an optional loan picked from their own loan accounts. Each one shows its value and date (marked "over a year ago. Update it?" after 365 days), and with a loan, "You own about $X of it" (value minus the loan's balance). Net worth counts them as assets ("Includes $X for things you own (your values)"), and month by month each counts from the month of its value. A mortgage or car loan with nothing linked to it gets "Add your home's value to see your equity" on /loans and /net-worth, opening the form with the kind and loan filled in. Jane never estimates or looks up a value. Stored in owned_assets; included in Download my data, removed with the account; analytics asset_added, asset_updated and asset_removed carry no amounts |
| 68 Insurance policies and documents | PR #86 | New /documents page ("Policies and receipts", linked from Home and Settings): upload an insurance policy, warranty, receipt or anything else as a PDF, JPEG, PNG or WebP (checked by the file's first bytes as well as its stated type), up to 4 MB each and 50 files a person, 20 uploads an hour. Files are AES-256-GCM encrypted in a new documents table and only ever decrypted for their owner (anyone else gets "not found"); photos open in the browser (sandboxed) and PDFs download from the page. With ANTHROPIC_API_KEY, Claude reads the key facts (company, kind of policy, a one-line summary, price and how often, renewal date, warranty end, purchase date and amount); the summary must pass the guardrails or is dropped. Without a key, or when reading fails, the person fills in a short facts form, and they can always correct the facts. An insurance card whose company matches an uploaded policy shows "Renews on …" and the policy's price beside the card (the card itself is unchanged). documentDates() lists renewals, warranty ends and receipts' usual 30-day return windows for the deadlines step. Download my data lists documents and their facts, not the files; deleting your data deletes them. Uploads, reads, views, fact changes and deletions are audit-logged, never the file or its contents |
| 69 Can I afford this? | PR #83 | New /afford page (linked from Home): enter a one-time purchase (amount and date, today by default) or a monthly change (more or less going out, from a starting month) and see "Safe to spend until payday: $X → $Y", each goal in progress (a purchase: the monthly amount to still reach it on time; a monthly change: when it would be reached at the new pace, if the money came from that goal), and checking at the end of each of the next 12 months before and after, as plain bars with the amounts written out, naming the first month below zero. Safe to spend is the same number Home shows; the months count expected deposits and regular bills on checking, not everyday spending. The form lives in the URL (?kind=…&amount=…&date=…&month=…), so a result can be shared and nothing is saved. Math only (src/planning/afford.ts), with every sentence in afford-copy.ts checked by the recommendation guardrail; limits in src/config/afford.ts ($1 million, 12 months). Tracks afford_checked with the kind only, never amounts |
| 70 Saving for irregular costs | PR #81 | Bills that come less often than monthly and seasonal spending now become a monthly amount to set aside (src/insights/irregular.ts, thresholds in src/config/irregular.ts). Jane finds quarterly and yearly charges (from Plaid's streams or our own detection), bills paid twice a year, a yearly bill seen once when its category or name says so (car registration, licences, annual fees), and seasons like holiday gifts in November and December when shopping is well above the usual month. Each has its yearly total, next date and monthly share (yearly / 12, rounded up to the dollar); nothing from loan or investment accounts, transfers or loan payments. /budgets lists them under "Set aside for yearly bills" with how much should be put by now for each. Safe to spend takes this month's share off as its own line (a "Yearly bills" goal isn't counted twice). The plan proposes a "Yearly bills" savings goal of a year of the monthly total, included in "Use Jane's suggestions"; a no is remembered and anyone with such a goal gets none. The demo bank now has a yearly DMV registration and holiday gifts |
| 71 Deadlines | PR #84 | New /deadlines page (linked from Home): everything due in the next 90 days, soonest first, under This week, This month and Later. Jane works out return windows for one-off shop purchases of $100 or more (30 days, or the shop's usual window for Apple, Best Buy, Target, Walmart, Home Depot and Costco; a refund of the same amount drops it), trials that started with a $1-or-less charge from a subscription and haven't charged the full price yet (an estimated 30 days), yearly and quarterly renewals, and card and loan due dates from the bank. The person adds their own (FSA deadline, card benefit, warranty, anything else) and can mark them done or delete them; they're a new deadlines table, in Download my data. A new alert, "Deadline coming up" (deadline_soon), reminds once, 3 days before (5 for return windows), by email unless turned off in settings; renewals and payments keep their own "Renews soon" and "Bill due soon" reminders. The daily job raises them for everyone. All numbers are in src/config/deadlines.ts. Uploaded documents (step 68) add their dates too: a policy's renewal, a warranty's end and a receipt's return window, each linking to /documents; a policy renewal gets the reminder, since nothing else reminds about it. The demo bank has a $1,349 Apple Store purchase and a Paramount+ trial |
| 72 Life events and tax-time pack | PR #85 | New /life-events page (linked from Home): start a checklist for moving, a new job or a new baby (src/config/life-events.ts, 8 plain items each, some linking to Budgets, Goals, Subscriptions or the report), tick items off, finish or delete it; one open checklist per kind, kept in a new life_events table and included in Download my data. New /tax-pack page (linked from Home), for last year until April 30 and this year after, or any of the last six years: charity gifts, then "Spending people often show their tax preparer" (medical without vet bills, childcare, education, and this year's student loan and mortgage interest as the bank reports it), each with dates, payees and totals, and contracting or gig income by quarter with the IRS estimated-payment dates (April 15, June 15, September 15, January 15; src/config/tax-pack.ts, pointing to irs.gov). Organizing only: static wording in src/planning/tax-pack-copy.ts, no Claude text, never "deductible", "write-off" or what to pay. Download as CSV (the person's own transactions, spreadsheet-formula safe, audit-logged). People with contracting or gig income get an in-app alert 14 days before each estimated-payment date, once per date (alert type estimated_tax). The demo bank has two Red Cross gifts, pharmacy and dentist charges |
| 73 Devices and sessions | PR #89 | Settings has a "Where you're signed in" section (/settings#sessions): each unexpired session with its device ("iPhone · Safari", "Mac · Chrome", or "Unknown device", worked out from the browser's user agent in src/lib/devices.ts with no new library), the day it signed in and roughly when it was last active, with "This device" on the current one. Each other session has "Sign out", and "Sign out other devices" ends the rest. A signed-out session stops working on its next request, because every page looks the session up in the database. Sessions are named by their row id; the session token is only compared on the server and never reaches the page. sessions gains user_agent (first 300 characters) and last_seen_at, written after the response at most every 10 minutes (src/config/sessions.ts); no IP address is stored. Sign-outs are audited (session_signed_out, other_sessions_signed_out) and tracked as counts only. Expired sessions are hidden, and the daily cleanup already deleted them |
| 74 Who saw my data | PR #90 | New /settings/team-access page ("Who saw my data", linked from Settings and the Privacy page): every time our concierge team or Jane's agent viewed or acted on the person's data, newest first, from the audit log. Each entry has the date and time, who by role only ("Our concierge team" or "Jane's agent", never a team member's name, email or id), what in plain words ("Viewed your request", "Started working on it", "Wrote to Netflix", "Read Netflix's reply", "Passed it to the team"…) and the request it was for, linking to /actions. The page shows the latest 100 (src/config/team-access.ts); Download my data has the full list (teamAccess). Every audit event has a recorded decision in src/lib/team-access.ts (shown, the person's own, automatic, or not about one person), so a new event can't be added without one. The queue view is now logged once per person whose requests were listed, naming those requests, and the few team and agent events that didn't name the person now do. Queue views from before this step named no one, so they can't be shown. Empty state: "Our team hasn't looked at or acted on your data." |
| 75 Demo bank | PR #78 | A stand-in for Plaid until there are keys. "Link a demo bank" on /connect makes an ordinary plaid_items row (ids start with demo-; the encrypted access token names the demo seed and the day it was linked) that the normal sync, daily refresh and removal handle; a fake Plaid API (src/lib/plaid/demo.ts) answers in Plaid's place and never calls Plaid. It holds checking, savings, a credit card, a mortgage, a student loan and a car loan, a year of Plaid-shaped transactions with real PFC categories (src/data-sources/demo/demo-bank.ts) and loan details. The data is deterministic (later syncs add only the new days) and built so every finding shows up: a Netflix price rise, high phone and internet bills, overdraft and service fees, card interest, a converted trial, a duplicate charge, insurance, subscriptions and idle cash. A banner on every signed-in page says it's fake data and links to removing it. Offered only when Plaid isn't set up and outside production, or anywhere with DEMO_BANK=1 |
| 76 The best option for you | PR #79 | Cards for a phone or internet bill, a subscription (price rise or review) and idle cash now compare the options Jane knows and pick the best one for the person: the lowest first-year cost (fees included) for the same kind of service, or the savings account they qualify for that earns the most (src/planning/compare.ts). The card shows "The best option for you" with Jane's pick already selected, up to two runners-up (price, saving, what's included, contract, fee, what's given up, the day the price was checked and its source) and "Don't switch" (the old action); one yes switches. The choice is checked against the comparison and kept on the decision as it was shown. Options live in switch_options, kept by the team on /admin/options (add, "Checked today", remove); only options checked on the provider's own page in the last 90 days (OPTION_STALE_DAYS) and saving at least $24 a year are compared. Never insurance or investments. Example options with made-up providers exist only for people using the demo bank, labelled "Example, not a real offer" |
| 77 Jane switches for you | PR #79 | A yes on a switch becomes one action (agent state switching), whatever the finding: the person gets one "Sign up for …" button and Jane watches the account (after each sync and daily). A cheaper tier is done when the cheaper charge shows up; another provider's plan when its first bill shows up, and only then does the team cancel the old one, so the person is never without service; a savings account when the money is seen moving out (Jane never moves money). The saving is counted from the real new charge. No sign of it in 45 days (SWITCH_WATCH_DAYS) passes it to the team. On the demo bank, the new bill arrives two days after a switch so the whole loop can be tried |
| 78 Jane in iMessage | PR #91 (removed in PR #99) | Built, then removed at the user's request: they decided they don't want Jane to text them. Texts through Sendblue (alerts, the weekly plan with approval by reply, "needs you"), the Texts section on /settings, /settings/texts and /api/messaging/inbound are gone, and a migration drops the text_settings and text_messages tables and the decision source "text" (any approval made by a text reply is kept, counted as a one-tap link). The shared approve and take-back helpers in plan-links.ts stay, used by the one-tap link |
| 79 Navigation, Today and Settings | PR #92 | One menu with five places: Today (/home), Jane (/jane), Money (/money), Ahead (/ahead) and Ask, plus a profile icon holding the signed-in email, Settings and Sign out. On phones it's a tab bar along the bottom with icons, kept clear of the page and the iPhone home indicator; on computers the same five sit along the top. The tab for the page you're on is highlighted; every existing page is mapped to one tab in src/config/navigation.ts (Settings, /connect and /import light up the profile icon), and a test reads the pages from src/app so a new page can't be left out. Home is now "Today", with only what needs you: Jane's plan this week ("N things, could save $X a year", Review and approve), safe to spend until payday, Needs you (actions waiting on you and new alerts), Coming up (the next 7 bills, deadlines and card or loan payments in the next month, soonest first, a bill that's also a deadline shown once; src/insights/coming-up.ts), what Jane did this week, Getting started for new people, and "N new things to decide" linking to the Jane tab. Money found, saved and in progress are one line under the heading. The row of 13 links, goals, budgets and "New for you" left Home for the Money and Jane tabs. Settings is in four groups with a menu at the top: Accounts, Notifications, Autopilot, and Privacy and security; every old anchor (#banks, #alerts, #autopilot, #rules, #two-factor, #sessions; #texts until texts were removed) still works. The Jane, Money and Ahead pages themselves are step 80 |
| 80 Jane, Money and Ahead hubs | PR #93 | Three new pages that gather the existing ones; every old page and link still works. /jane ("What Jane is doing for you"): To decide (the plan's top 5 cards with their saving and Jane's pick when there's one, linking to each card, plus "See the full plan" and "All findings"), In progress (open actions with their status, waiting-on-you first with what's needed), Done (finished actions with what they saved, and the saved-so-far total) and the 3 newest unread alerts (seeing them there doesn't mark them read). /money ("Your money"): tiles for net worth, investments (only with an investment account), things you own ("Add your home" when a mortgage has nothing linked), goals on track, spending this month, budgets over, bills and subscriptions (with a second link to Coming up), transactions, loans and cards owed, and documents. /ahead ("Plan ahead"): deadlines (the next one and how many in 30 days), the yearly-bills set-aside (linking to the new /budgets#yearly), paying off debt, can I afford this, life events (a checklist in progress), the tax-time pack year, the monthly check-in and the year in review. Each number comes from the same code as its full page; every tile has a friendly empty state. One shared tile (src/components/hub-tile.tsx), two across on a phone and three on a wider screen. Limits live in src/config/hubs.ts |
| 81 The chat as home | PR #100 | Home is now Jane's chat (/chat): Jane's messages, newest at the bottom, opened at the end, the last 50 with "Show earlier", in the ASCII style. Each message is a jane_messages row (kind brief, decision, done, heads_up, reply or user; body; refs; buttons; open, answered or dismissed with what was chosen; a dedupeKey unique per person), in Download my data and deleted with the account. Buttons, from one registry (src/lib/jane-agent/actions): Yes, No and Jane's pick ("Switch to …") on a finding, through recordDecision with the card hash and a new decision source "chat"; "Approve all safe ones" on the week's plan, through yesToAll on the same no-risk items as the one-tap link (never calls, cancellations, insurance or moving money); Undo on a rule's yes (within a day, before work starts) and on a No (for a few seconds, then the buttons come back); and Open links. Each tap is checked on the server (the person's own message, still open, offering that button) and works only while the finding is what the message said; it's audited (chat_action_taken) and tracked without amounts. An answered message shows "You chose: …" and a line on what happened, and messages answered elsewhere (on the card, the plan, a rule) lose their buttons. The menu is Chat (>_), Today, Jane, Money and Ahead; Ask left the tab bar for the "Ask Jane anything" box at the bottom of the chat and still lights up Chat. Sign-in, two-factor, the Terms and the installed app now open the chat; the demo bank's scan ends there too |
| 82 Jane's brain | PR #100 | Jane decides what to say by itself (src/lib/jane-agent/brain.ts, pure): five message sources, each its own module in one list. The morning brief once a day from 7am (safe to spend until payday, bills due in 2 days, how many things wait); findings worth deciding, time-sensitive ones first, then the biggest yearly saving, with Jane's pick when it compared options; the week's plan ("N things, could save $X a year", Approve all safe ones, Review); "I did this" (a standing rule's yes with Undo for a day, and work the agent finished in the last week with what was confirmed); heads-ups (urgent alerts except double charges, said as findings, and deadline reminders, said as the deadline; deadlines in the next 3 days; a step only the person can do; a budget gone over; a goal whose date passed short). Limits in src/config/agent-chat.ts: 5 messages a day besides the brief, with a cap per source (3 findings, 2 heads-ups, 2 "I did this", 1 plan), counted in the person's own day; quiet from 9pm to 8am in users.timezone (US Pacific when unset; a new helper, src/lib/jane-agent/quiet-hours.ts); never the same dedupeKey twice (also a unique index); most important first. The runner loads everything with the existing loaders (Today's summary, the plan, comparisons, rules, alerts) and posts after each bank or demo-bank sync, after a CSV import, from the daily digest job (up to 200 people a run, the longest since Jane posted first) and when the person opens the chat with nothing posted yet today (then quiet hours and the 7am start don't apply: they're looking). A failure there never fails a sync or import |
| 83 Every feature from the chat | PR #102 | Five more message sources and twelve more buttons, each through the feature's own code and checked again on the server. Autopilot: until the person picks a level, one "How much should I do on my own?" message with Handle the safe stuff, Handle everything allowed and Ask me first (setAutopilot, as in Settings; asked once and outside the daily limit). Set-up suggestions: each budget and goal on the plan, the Yearly bills goal included, said as math from their own numbers, with Set it up, No and (with more than one) Use all N suggestions (answerProposal, acceptAllProposals). Things waiting on the person: a company's question with Answer (opens that action), an offer made on a call with Accept and Decline (answerOffer), a company that only cancels online with Open cancel page and I've cancelled (markSelfCancelled), and a switch with Sign up; the general "I need you for one step" message skips these. Budgets nearly used up (90%, in src/config/agent-chat.ts) with Open and Snooze, and Snooze on one gone over. Deadlines in the next 3 days: Mark done on ones the person typed in (markDeadlineDone) and Remind me tomorrow on all. Urgent alerts: Got it marks that alert read. Things you own: a mortgage or car loan with nothing linked gets "Add your home's value" (or car's), opening the form prefilled. "Not now" (and Snooze, Remind me tomorrow) hides a heads-up until the start of the person's tomorrow (jane_messages.snoozed_until); Jane never posts it again before then and brings it back at the bottom with its buttons after, if it still applies. Messages answered elsewhere (autopilot in Settings, a suggestion on the plan, a step on Actions, a deadline, an alert) lose their buttons. Calls, cancellations, insurance and moving money still only happen with the person's own tap. None of these pages has an undo, so these buttons have none either |
| 84 Typing to Jane | PR #101 | The box at the bottom of the chat is a real one: what you type is a "user" message and Jane's answer a "reply" right under it, capped at 500 characters and 60 messages an hour. Rules answer first, with no key needed (src/lib/jane-agent/intents.ts, pure): "can I afford $900 for a trip in March" (the effect on safe to spend, goals and checking from the afford page's math; for a later month a "Start a goal for it" button), "how much did I spend on food last month" (categories in everyday words, or a merchant), "what's due (this week)", "safe to spend", "cancel Hulu" / "lower my phone bill" / "get my refund from Target" (the matching open finding with its Yes, No and Jane's pick, or "I don't see anything open" with Open subscriptions), "what did you do", "yes to all" (offers Approve all safe ones), "undo" (offers Undo on a rule's yes), "pause autopilot" (offers a Pause button) and "help". Typing never acts: every change is a button, checked again when tapped; two new buttons were added to the registry (Start a goal, Pause autopilot). With ANTHROPIC_API_KEY set, anything else goes to Claude with the last 10 typed messages and answers only, read-only tools (Ask's, plus safe to spend, coming up, findings, goals, budgets and net worth), at most 6 rounds and Ask's hourly limit; its one propose_action tool can only offer a registered button (a finding's Yes and No, Approve all safe ones, a goal, or a link to a known page). Every Claude answer passes the guardrails or is replaced by safe text with no buttons. Typed text is in Download my data, deleted with the account and never logged (analytics get only the kind of question). /ask still works and its old conversations stay readable there, linked from the chat when you have some |
| 85 Jane's messages as notifications | PR #103 | Jane's important chat messages now reach the person outside the app: things to decide and the week's plan, heads-ups, and "I did this" with Undo (the morning brief only if they turn it on; heads-ups about alerts go out as alerts, never twice). With phone notifications on, each goes straight away as a notification titled "Jane" with the message and up to two of its buttons ("Yes", "No"); tapping a button answers it through a new signed-in endpoint (/api/chat/act) with the chat's own checks, and signed out it just opens the message in the chat (/chat#message). Without a phone, or for people who prefer email, one email lists everything that sat unread for an hour (from the daily run straight away), in Jane's ASCII look, each button a one-tap link to a small confirm page (/chat/reply) with the message and one button: hashed token, works once, for 3 days, only that person's own message, and someone else signed in is refused. Limits in src/config/chat-notify.ts: 6 a day, 2 emails a day, 5 messages an email, nothing older than a day, nothing in quiet hours (9pm to 8am) and nothing already read, answered or sent (jane_messages.notified_at and notified_via). Sending is a job (chat_notify) so failures retry. Settings → Notifications has "Messages from Jane": phone notifications (email until they're on), email, both or off, and which kinds; changes apply at once, and the email's "Stop these emails" link turns email off. Audited (chat_notification_sent: channel and kind only) and tracked. Phone notifications need the VAPID keys and email needs Resend's key |
| Chat fixes after Phase U | PRs #105–#112 | From the founder trying the chat: "can I spend $500 this week for food" is an affordability question with the food budget and a usual week next to it (#105); free questions use a faster model (ANTHROPIC_CHAT_MODEL, default Sonnet 5.5, low effort) with the person's main numbers sent up front and the answer streamed a sentence at a time, each past the guardrails (#106); every figure in what Jane was given counts for the guardrails and a failed answer gets one rewrite before the fallback, and greetings are answered by rules (#107); finding_details and subscriptions tools so Jane suggests what to do from the evidence and the compared options (#109); Jane's own messages have a yellow edge, her answers stay plain (#111); /transactions no longer scrolls sideways on phones (#108); the header reads the session once (#110); automatic Vercel deploys are off (#112) |
| 86 The tabs become details | PR #117 | Chat lane. The other places open from the chat and sit behind a Details menu; every old address still works |
| 87 Jane's answer checks | PRs #122, #128 | Chat lane. A graded question bank over the demo bank; the rules-only part runs in CI, the Claude-graded part needs ANTHROPIC_API_KEY (none locally, so it's skipped and reported). #128 kept tax wording out of the help examples so the checks stay at their floor |
| 97 Jane notices changes | PR #120 | Thinking lane. Bill amount changes, new subscriptions, paycheck changes, spending running hot and new fees, as heads-ups with buttons; price rises and new fees start the fix by themselves at the right autopilot level |
| 98 Demo advice mode | PR #116 | Thinking lane. adviceMode(userId) in src/lib/advice-mode.ts (demo-bank people only; production needs DEMO_ADVICE=1), a demo_advice guardrail profile, the "Demo advice: sample data, not financial advice" label, REAL_ACCOUNT_ADVICE off in src/config/advice.ts; CLAUDE.md updated |
| 99 Insurance and renewals from payments | PR #135 | Thinking lane. Policies found from insurer payments (Confirm / Not insurance), renewals and annual fees as deadlines |
| 100 Life events spotted | PR #124 | Thinking lane |
| 101 Plans that keep up, and a weekly review | PR #126 | Thinking lane |
| 102 Every policy, understood | PR #125 | Insurance lane. Insurance profile, coverage gaps, in the chat |
| 103 Quote engine | PR #133 | Insurance lane. An insurance partner interface with a stand-in carrier catalog, compared like for like |
| 104 Shopped for you | PR #137 | Insurance lane. Jane reshops by herself, picks the best and asks once |
| 109 Every debt in one place | PR #121 | Loans lane |
| 110 Payoff plans | PR #141 | Loans lane |
| 118 Tax profile | PR #119 | Taxes lane. Worked out from the accounts, asked in the chat |
| 119 Tax organizer | PR #130 | Taxes lane. Tags, forms to expect, a pack that matches them |
| 120 Tax estimate | PRs #136, #139 | Taxes lane. Federal and state, 2026 figures in config marked for review; #139 kept "how much do I owe" for debts |
| 128 Holdings | PR #118 | Investments lane. Demo holdings shaped like Plaid Investments, with sources |
| 129 Risk and goals | PR #123 | Investments lane. The investor profile (src/planning/investor-profile.ts), asked in the chat in demo advice mode |
| 130 Fee finder | PR #127 | Investments lane. Expense ratios and cheaper equivalents are stand-ins in src/config/funds.ts; assumptions with sources in src/config/market-assumptions.ts |
| 131 Portfolio review | PR #131 | Investments lane. Target mixes per risk level in src/config/investing.ts |
| 132 Retirement planner | PR #134 | Investments lane. EmployerPlanSource stand-in for pay and match terms |
| 138 Try Jane without signing up | PR #132 | Thinking lane |

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

- **Read-only until counsel says otherwise.** No money movement, investing, investment advice, or tax and legal advice. Phase P lists what needs licenses; it goes through licensed partners, built against their sandboxes, and doesn't go live until the partner and counsel sign off. The one exception is demo advice mode (step 98): recommendations on the demo bank's sample data only, always labelled, never for real accounts.
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

## Phase S: Jane in your messages (step 78)

Removed (PR #99): Jane texted alerts, the weekly plan and "needs you" through Sendblue, and approvals came back by reply (PR #91), but the user decided against texting.

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

## Phase T: one place for everything (steps 79–80)

About 30 pages were added one step at a time. The menu had nine overlapping links, Home
had a row of 13 more and Settings 13 mixed sections. Now there are four tabs plus Ask,
and Settings behind the profile icon. Nothing is removed, and every old address still
works, since emails and texts link to them.

| Tab | Address | What it's for | Pages under it |
| --- | --- | --- | --- |
| Today | /home | Only what needs you now | |
| Jane | /jane | Everything Jane found and is doing | /plan, /report and each card, /actions, /alerts |
| Money | /money | The picture of your money | /net-worth, /loans, /things, /goals, /budgets, /subscriptions, /bills, /transactions, /insights, /documents, /household |
| Ahead | /ahead | Planning | /afford, /deadlines, /debt, /life-events, /tax-pack, /check-in, /year |
| Ask | /ask | Questions about your money | |
| Settings (profile menu) | /settings | Your account and choices | /settings/*, /connect, /import |

### Step 79: Navigation, Today and Settings

> Read CLAUDE.md. One menu, a calmer Home and a grouped Settings.
>
> Build:
> 1. The menu (src/components/app-header.tsx) shows the five places, with a profile menu
>    holding the signed-in email, Settings and Sign out. On phones it's a tab bar along the
>    bottom (icon and label, 44px targets) that never covers the page and sits above the
>    iPhone home indicator; from sm up, the same five along the top. The tab for the
>    current page is highlighted (aria-current="page"), from one tested map of every page
>    to its tab (src/config/navigation.ts). The demo-bank banner stays. Admin pages keep
>    their own menu.
> 2. Today (/home), in this order: Jane's plan this week ("N things, could save $X a
>    year", Review and approve); safe to spend until payday with how it's worked out;
>    Needs you (actions waiting on the person, new alerts); Coming up, the next 7 bills,
>    deadlines and card or loan payments over the next month, soonest first, with the same
>    bill shown once even when it's also a deadline (src/insights/coming-up.ts); what Jane
>    did this week; Getting started for new people; and one line, "N new things to
>    decide", to the Jane tab. Money found, saved and in progress fit on one line under the
>    heading. The row of links, goals and "New for you" move to the Money and Jane tabs.
> 3. Settings in four groups, with a menu of them at the top: Accounts (connected banks
>    and adding one, your accounts, household, where you live), Notifications (email,
>    alerts, texts), Autopilot (the level and standing rules) and Privacy and security
>    (two-factor, where you're signed in, who saw my data, the money calendar link, your
>    data, delete all my data). Every section keeps its anchor (#banks, #alerts,
>    #autopilot, #rules, #two-factor, #sessions, #texts).
>
> Acceptance criteria:
> - Every signed-in page belongs to exactly one tab (tested against the pages in src/app)
> - No sideways scroll at 375px, and the tab bar never hides the end of a page
> - Every old address and anchor still works

### Step 80: Jane, Money and Ahead hubs

> Read CLAUDE.md. A front page for each tab.
>
> Build:
> 1. /jane, /money and /ahead each gather the tab's existing pages as cards, each with a
>    live number from the person's data (what's in the plan, net worth, the next deadline)
>    and a link to the full page.
> 2. Nothing new is worked out on a hub: each number comes from the same code as its page.
>
> Acceptance criteria:
> - Each hub's numbers match the pages they link to
> - Every page in the tab is reachable from its hub

## Phase U: Jane the agent (steps 81–86)

Jane so far is a place to check: five tabs full of features. Now Jane comes to the person.
Every day it looks at their money and posts what matters in one chat, with buttons to
answer, so they don't have to go looking or think about what to do next. The chat is the
home screen; the tabs become the details behind it. First in the app, then as
notifications (push and email) that can be answered, later as a native app.

Ground rules for every step in this phase:
- Jane's messages are fixed templates in Jane's voice (short, plain, friendly); any text
  from Claude (step 84) passes the guardrails before it's shown. No investment, tax or
  legal advice.
- Every button works through the code the rest of the app uses (decisions, the plan,
  standing rules and their undo), never a shortcut, and is checked on the server: the
  person's own message, still open, offering that button.
- Moving money, cancellations, insurance and calls still need the person's own tap; a
  chat button is one, autopilot never is.
- Jane never says the same thing twice, keeps to a daily limit and stays quiet from 9pm to
  8am in the person's timezone (src/config/agent-chat.ts).

### Step 81: The chat as home

> Read CLAUDE.md. One chat where Jane talks to the person, as the home screen.
>
> Build:
> 1. jane_messages (user-owned, in Download my data, deleted with the account): kind
>    (brief, decision, done, heads_up, reply, user), body, refs (finding, action,
>    decision…), actions (the buttons: id, label, primary, secondary or link), status (open,
>    answered, dismissed) with what was chosen and when, a dedupeKey unique per person,
>    priority and readAt.
> 2. /chat: newest at the bottom, opened at the end, the last 50 with "Show earlier". Jane's
>    messages on the left with their buttons; an answered one shows what was chosen instead,
>    keeping Undo while it works. A message box at the bottom ("Ask Jane anything") opens
>    /ask until step 84. ASCII style; fits a 375px phone and the tab bar never covers the
>    newest message.
> 3. Home is /chat: a Chat tab first in the menu, then Today, Jane, Money and Ahead; Ask
>    leaves the tab bar for the message box, and /ask still works under Chat.
> 4. Buttons, as one registry of button actions (src/lib/jane-agent/actions): Yes, No and
>    Jane's pick on a finding (recordDecision with the card hash, source "chat"; the pick as
>    the option to switch to), "Approve all safe ones" on the week's plan (yesToAll on the
>    one-tap link's no-risk items), Undo (a rule's yes within a day; a No within seconds),
>    and Open links to the detail page.
>
> Acceptance criteria:
> - Another person's message, a message no longer open, or a button it doesn't offer is
>   refused, and changes nothing
> - "Approve all safe ones" never includes cancellations, calls, insurance or moving money
> - Undo works only while the app's own undo does

### Step 82: Jane's brain

> Read CLAUDE.md. Jane decides what to say, every day, by itself.
>
> Build:
> 1. A pure brain (src/lib/jane-agent/brain.ts): plan(snapshot, history, now, settings)
>    returns the messages to post, from one registry of message sources, each its own
>    module: the morning brief (once a day after 7am: safe to spend until payday, bills
>    due in 2 days, how many things wait), findings worth deciding (the biggest saving
>    first, with Jane's pick), the week's plan, "I did this" (what autopilot did, with Undo
>    while allowed) and heads-ups (deadlines in 3 days, a budget gone over, a goal falling
>    behind, a step only the person can do, urgent alerts).
> 2. Limits in src/config/agent-chat.ts: a daily cap besides the brief, a cap per source,
>    quiet hours in users.timezone, never the same dedupeKey twice, most important first.
> 3. A runner that loads the snapshot with the existing loaders and posts: after a bank or
>    demo-bank sync, after a CSV import, from the daily job (batched and capped), and when
>    the person opens the chat with nothing posted yet today.
>
> Acceptance criteria:
> - Linking the demo bank lands on /chat with a brief, findings with buttons and the plan
> - A second run posts nothing already posted; nothing is posted in quiet hours unless the
>   person opens the chat
> - Each source and each limit has its own test, timezones included

### Step 83: Everything from the chat

> Read CLAUDE.md. Every feature Jane already has, usable from the chat.
>
> Build:
> 1. New sources and buttons for what's still only on the pages: Change on a plan item
>    (its options as buttons), do-it-yourself kits, the agent's one-tap steps (cancel pages,
>    "I've cancelled it", sign-up links for a switch), call offers, set-up proposals
>    (budgets and goals), category filings, bill reminders, the monthly check-in and
>    alerts as they're raised.
> 2. Yes, No and Undo on each, through the same code as its page, with Undo wherever the
>    page has one.
>
> Acceptance criteria:
> - Each new button has a test that it works, refuses another person's message and a
>   message no longer open
> - Nothing that needs the person's own tap is ever done without it

### Step 84: Typing to Jane

> Read CLAUDE.md. The message box becomes a real one.
>
> Build:
> 1. What the person types is a "user" message; Jane's answer is a "reply". Rules first:
>    commands ("yes to all", "undo", "pause autopilot", "what's due this week") and
>    questions about their numbers, answered from the same loaders as the pages.
> 2. With ANTHROPIC_API_KEY set, anything else goes to Claude with the person's own data,
>    like Ask (the same tools and limits), through checkGuardrails before it's shown. Free
>    text never approves anything: Jane answers with the buttons to tap.
> 3. /ask moves into the chat; its old conversations stay readable.
>
> Acceptance criteria:
> - Every command has a test; without a key, everything works except free questions
> - No reply shows advice the guardrails refuse; typing never acts without a tap

### Step 85: Chat messages as notifications

> Read CLAUDE.md. Jane's messages reach the person where they are.
>
> Build:
> 1. A new message goes out as a push notification (where push is on) or, when unread for a
>    while, in an email digest of what's waiting, in quiet hours' limits and a daily cap,
>    each with links that open the message in the chat.
> 2. Replies come back: a notification's action buttons and email links answer the same
>    button on the same message (signed, single-use, the person's own, like one-tap links),
>    so the safety rules stay the chat's.
> 3. Notification settings per kind of message in Settings.
>
> Acceptance criteria:
> - Nothing is sent in quiet hours or past the cap; a reply only answers its own message,
>   once
> - Turning a kind off stops it at once

### Step 86: The tabs become details

> Read CLAUDE.md. The chat is where things happen; the other pages are its details.
>
> Build:
> 1. Today, Jane, Money and Ahead open from the chat ("See today", "Open") and move behind a
>    "Details" menu; every page and address still works, since emails link to them.
> 2. Each detail page links back to the chat message it came from, and answering on the
>    page answers the message too.
>
> Acceptance criteria:
> - Every page is reachable from the chat or the Details menu (tested against src/app)
> - Answering on a page or in the chat shows the same answer in both

## How every step from 87 on is built

The goal is an agent that is the person's complete financial controller and needs as little
from them as possible. So every step from 87 on, in every sector, follows these rules:

- **Automation first.** Jane does the work herself: she finds, compares, prepares and,
  within the person's autopilot level (step 57), acts. The person's part is a yes, a no, or
  nothing at all. Each step says what Jane does on her own at each autopilot level; anything
  that moves money, signs a contract, applies for credit, cancels cover or files with a
  government still needs one tap.
- **In the chat.** Each feature is built into Jane's chat in the same step: a message source
  for the brain (when Jane brings it up by herself), buttons through the feature's own code
  with the chat's server checks, rule answers for the questions people will ask about it,
  and Claude tools so free questions about it get real answers. A feature isn't done until
  Jane can talk about it and act on it.
- **Stand-ins, never blocked.** Anything that needs an outside account, a licensed partner
  or counsel is built against a stand-in behind a switch (like the demo bank), with what to
  swap in later written down in the step's notes.
- **Advice.** Recommendations on investments, taxes, insurance and loans run in demo advice
  mode (step 98): demo-bank data only, always labelled, never for real accounts until a
  licensed partner and counsel sign off.
- **Measured.** Chat changes are scored with step 87's answer checks; every rule, route,
  button and message source has tests.

## Phase V: a professional chat (steps 87–96)

### Step 87: Jane's answer checks

> Read CLAUDE.md. Measure Jane's chat answers before changing them.
>
> Build:
> 1. A bank of about 100 real questions over the demo bank, each with what a good answer
>    has: answered (not a fallback), the right figures, step 89's shape, the right button,
>    nothing the guardrails refuse, a length limit. Follow-up pairs too ("should I cancel
>    Netflix" then "and Hulu?").
> 2. A runner that asks Jane each question and grades it: fixed checks first, then a
>    Claude grader with a written rubric for usefulness and tone; a score per question and
>    overall, saved per run; a spending cap per run. Without ANTHROPIC_API_KEY it runs the
>    rules-only questions and the fixed checks, and says the rest was skipped.
> 3. Rules-only questions run in CI.
>
> Acceptance criteria:
> - Every question gets a grade and a reason; runs are comparable; a run stops at its cap

### Step 88: Jane understands more

> Read CLAUDE.md. Fewer misunderstandings, more instant answers.
>
> Build:
> 1. Rule answers for what people type most: a merchant's cost, the next paycheck, the
>    subscription list, the biggest spending this month, a finding by name, typos and short
>    forms.
> 2. Follow-ups: the last finding, merchant or month talked about is remembered for the
>    conversation ("and Hulu?", "what about last month?", "cancel it").
> 3. A clarifying question with a button per meaning when a message could mean two things.
>
> Acceptance criteria:
> - Each rule and follow-up is tested; "it" never points at something from another day

### Step 89: One professional answer shape

> Read CLAUDE.md. Every answer looks and sounds the same.
>
> Build:
> 1. The answer in the first sentence, then the reason with the person's figures, then one
>    suggestion (ranked by what it saves) with its button; a short list only when comparing.
> 2. One voice: warm, brief, no filler; "$17.99 a month"; "Oct 28 (in 3 days)".
> 3. No dead ends: when Jane can't answer, the closest things she can do, as buttons.
>
> Acceptance criteria:
> - Step 87's shape and tone grades go up; rule answers follow the same shape

### Step 90: The right button, every time

> Read CLAUDE.md. Every answer that implies an action offers it.
>
> Build:
> 1. Buttons for everything the pages can do: Yes on a finding, "Set a budget"
>    (prefilled), "Start a goal", "Remind me later", "Don't suggest again".
> 2. Quick replies under answers: "Why?" (the evidence and the options compared, fixed
>    wording from finding_details), "Show options", "Do it".
> 3. After a tap, a plain confirmation of what happens next and when.
>
> Acceptance criteria:
> - Every button goes through its feature's own code and the chat's checks; "Why?" works
>   without a key

### Step 91: Jane remembers

> Read CLAUDE.md. Jane remembers what the person tells her.
>
> Build:
> 1. jane_preferences (user-owned, exported, deleted with the account): "don't suggest
>    again" and things said in the chat ("I need my car", "payday is the 15th"), saved after
>    a confirm button.
> 2. The brain, the chat and every later sector read them; Settings lists them, deletable.
>
> Acceptance criteria:
> - A dismissed suggestion never returns; nothing typed is saved without the confirm tap

### Step 92: Never interrupt

> Read CLAUDE.md. Jane's own messages wait their turn.
>
> Build:
> 1. While the person is chatting (a message in the last 10 minutes), Jane's own posts
>    wait and come after, bundled.
> 2. Related suggestions become one message with a list and a button each; a daily cap on
>    Jane's own posts, most valuable first.
>
> Acceptance criteria:
> - Nothing Jane posts by herself lands between a question and its answer

### Step 93: Fast and reliable

> Read CLAUDE.md. Quick, and never stuck.
>
> Build:
> 1. First words in under 2 seconds: numbers cached for a minute, cached instructions and
>    tools, the rules answer at once when one fits.
> 2. When Claude is slow or down, an instant answer from the rules, never a spinner.
> 3. Fewer false blocks: measure which guardrail rules block good answers (issue codes
>    only) and narrow them; /admin lists what Jane couldn't answer, by kind.
>
> Acceptance criteria:
> - Step 87 reports time to first words; blocked answers fall run over run

### Step 94: Rich answers

> Read CLAUDE.md. Show, don't just tell, in the ASCII style.
>
> Build:
> 1. Answer blocks the chat can draw: a bar chart of spending by category or month, a
>    table comparing options (cost, saving, what's different), a timeline of what's due,
>    a progress bar for goals and debts, all in monospace text that reads well on a phone
>    and to screen readers.
> 2. Rules answers and Claude (through a tool) can attach one block; figures in blocks pass
>    the same guardrails.
>
> Acceptance criteria:
> - Every block fits 375px and has a text alternative; figures match the pages

### Step 95: Guided flows in the chat

> Read CLAUDE.md. Multi-step tasks done in the chat, one question at a time.
>
> Build:
> 1. A flow engine: a short series of chat questions with buttons or a typed answer, back
>    and cancel, resumable later; each flow ends in the feature's own code.
> 2. Flows: set up budgets, start a goal, switch a provider, dispute a charge, the risk
>    questions (step 129), the tax profile (step 118).
>
> Acceptance criteria:
> - A flow can be left and resumed; cancelling changes nothing; each flow is tested end to
>   end

### Step 96: History and search

> Read CLAUDE.md. Find anything Jane said.
>
> Build:
> 1. Search the chat (words, merchant, amount, date); pin a message; a weekly "what we
>    covered" summary at the top of the week.
>
> Acceptance criteria:
> - Search only ever sees the person's own messages

## Phase W: Jane does the thinking (steps 97–101)

### Step 97: Jane notices changes

> Read CLAUDE.md. Jane spots what changed before the person does, and deals with it.
>
> Build:
> 1. Rules in src/config/changes.ts: any regular bill whose amount changed, a new
>    subscription, a paycheck late, smaller or from a new employer, a category running
>    well above its usual pace, a fee that's new.
> 2. Automation: a price rise on a bill or subscription starts a price fight or reshop by
>    itself at the right autopilot level; a new fee starts a refund request.
> 3. In the chat: heads-ups with "Set a budget", "Look into it", "That's expected".
>
> Acceptance criteria:
> - Each rule is tested with the demo bank and edge cases; "That's expected" sticks

### Step 98: Demo advice mode

> Read CLAUDE.md. Let Jane advise, for the demo only. (Built early: Phases X–AB need it.)
>
> Build:
> 1. adviceMode(userId): on for people whose data is the demo bank (in production only with
>    DEMO_ADVICE=1); real accounts keep today's rules.
> 2. A demo guardrail profile: recommendations on investments, taxes, insurance and loans
>    allowed; unsupported figures and promised outcomes still blocked. Every advice message
>    and page carries "Demo advice: sample data, not financial advice".
> 3. CLAUDE.md's rules updated to say so; the real-account switch names what it needs and
>    stays off in code.
>
> Acceptance criteria:
> - A real account never gets advice, whatever it types; tests cover both profiles

### Step 99: Insurance and renewals from payments

> Read CLAUDE.md. Jane fills in what she can see.
>
> Build:
> 1. Policies found from regular payments to insurers, added as "found from your
>    payments" (Confirm, Not insurance), and deadlines by themselves: yearly renewals, card
>    annual fees, trials that end.
> 2. In the chat: "I found your car insurance from your payments" with Confirm.
>
> Acceptance criteria:
> - Nothing counts until confirmed; renewal dates are estimates

### Step 100: Life events spotted

> Read CLAUDE.md. Jane notices big changes from someone's money.
>
> Build:
> 1. Rules for moving, a new job and a new baby (two or more signals each); Jane asks once
>    and, on Yes, runs the checklist herself: updates budgets, flags insurance to review,
>    sets reminders.
>
> Acceptance criteria:
> - One signal never asks; Not me and Don't ask again stop it

### Step 101: Plans that keep up, and a weekly review

> Read CLAUDE.md. Plans update themselves.
>
> Build:
> 1. Goal progress from transfers; budget tune-ups on the 1st (Accept all, Change, Keep),
>    accepted by themselves at the higher autopilot levels.
> 2. A weekly review in the chat: what Jane did, what it saved, what's next, one decision
>    at most.
>
> Acceptance criteria:
> - Nothing changes without a tap below the autopilot level that allows it

## Phase X: insurance (steps 102–108)

Jane handles insurance end to end: she knows every policy, checks the cover, shops it every
renewal and switches with one tap. Quotes come from a stand-in carrier catalog until a
licensed insurance partner is connected.

### Step 102: Every policy, understood

> Read CLAUDE.md. One place for all cover.
>
> Build:
> 1. An insurance profile: each policy (from payments, documents or typed) with kind,
>    carrier, premium, cover limits, deductible, renewal date and what's covered, and the
>    household facts that matter (home, car, dependants).
> 2. Coverage gaps by rules: renting with no renters cover, dependants with no life cover,
>    a car with liability only; demo advice says what to add.
> 3. In the chat: "What does my car insurance cover?", "When does it renew?", gaps as
>    heads-ups.
>
> Acceptance criteria:
> - Every figure comes from a policy record; gaps are explained in plain words

### Step 103: Quote engine (stand-in)

> Read CLAUDE.md. Compare insurance like for like.
>
> Build:
> 1. An insurance partner interface (quote request, quote, bind, cancel) with a stand-in
>    carrier catalog for the demo (auto, home, renters, life, pet), priced from the
>    person's profile with fixed rules.
> 2. Like-for-like comparison: same cover and deductible, or the difference spelled out.
>
> Acceptance criteria:
> - The stand-in is clearly a demo; the interface matches what a real partner returns

### Step 104: Shopped for you

> Read CLAUDE.md. Jane finds the best policy and says why.
>
> Build:
> 1. For each policy, quotes from the engine; the pick (lowest cost for the same cover,
>    weighted by the carrier's rating), why in three lines, the runners-up.
> 2. Automation: Jane reshops every policy 45 days before renewal and whenever a premium
>    goes up, by herself.
> 3. In the chat: "I found car insurance $312 a year cheaper for the same cover" with Yes,
>    Show options, Not now.
>
> Acceptance criteria:
> - Reshops run by themselves; nothing is bought without a tap

### Step 105: One-tap switch

> Read CLAUDE.md. Approve and Jane switches the policy.
>
> Build:
> 1. A switch action (step 77's machinery): bind the new policy through the partner
>    (stand-in), confirm the first payment, then cancel the old one and store the new
>    documents.
>
> Acceptance criteria:
> - The old policy is never cancelled before the new one is confirmed; no gap in cover

### Step 106: Coverage checkup

> Read CLAUDE.md. The right amount of cover (demo advice).
>
> Build:
> 1. Deductible tuning against the emergency fund, over- or under-insurance, bundling
>    discounts, cover that no longer fits (a car worth little with full cover).
> 2. Once a year by itself, and after life events (step 100).
>
> Acceptance criteria:
> - Each recommendation shows the cost and the risk it changes

### Step 107: Claims helper

> Read CLAUDE.md. Help when something happens.
>
> Build:
> 1. "I had an accident / a break-in": a guided flow (step 95) with what to do now, what to
>    collect, the carrier's claim contact, and a claim tracker with reminders.
>
> Acceptance criteria:
> - The flow works for each policy kind; the tracker never loses a step

### Step 108: Insurance in the chat and on autopilot

> Read CLAUDE.md. Insurance runs itself.
>
> Build:
> 1. At "handle everything", Jane prepares switches and only asks for the one tap; at
>    every level, renewals are watched and reshopped without being asked.
> 2. Rule answers and Claude tools for every insurance question.
>
> Acceptance criteria:
> - Step 87 gains insurance questions and they score well

## Phase Y: loans and debt (steps 109–117)

Jane knows every debt, finds a cheaper way to carry it and the fastest way out of it, and
handles the paperwork. Offers come from a stand-in lender catalog until a loan marketplace
partner is connected.

### Step 109: Every debt in one place

> Read CLAUDE.md. All debts, with their real terms.
>
> Build:
> 1. Loans, cards and buy-now-pay-later plans (found from Affirm, Klarna and Afterpay
>    payments), with rate, balance, minimum, term and payoff date (Plaid Liabilities-shaped
>    in the demo bank, typed otherwise).
> 2. In the chat: "How much do I owe?", "When is my car paid off?".
>
> Acceptance criteria:
> - Totals match net worth; every rate shows where it came from

### Step 110: Payoff plans

> Read CLAUDE.md. The fastest, cheapest way out of debt (demo advice).
>
> Build:
> 1. A plan across all debts: the order to pay (demo advice picks it and says why), extra
>    payment scenarios, a debt-free date, interest saved; the card planner (step 20)
>    extended to every debt.
> 2. Automation: the plan updates itself every month and Jane says when it's off track.
>
> Acceptance criteria:
> - The math matches the debt planner's; the plan updates by itself

### Step 111: Refinance offers (stand-in)

> Read CLAUDE.md. A cheaper loan, found for you.
>
> Build:
> 1. A lender partner interface (prequalify, offer, apply, status) with a stand-in lender
>    catalog: student, auto, mortgage, personal.
> 2. For each debt, offers compared by total cost over the same term with fees; the pick,
>    why in three lines, break-even for mortgages.
> 3. Automation: Jane checks rates every month by herself and posts only when a switch saves
>    a set amount.
>
> Acceptance criteria:
> - Offers compare total cost, fees included; nothing is applied for without a tap

### Step 112: One-tap apply

> Read CLAUDE.md. Approve and Jane does the paperwork.
>
> Build:
> 1. A prefilled application from what Jane knows, a review screen, a soft-check stand-in,
>    acceptance, then Jane watches the new loan pay off the old one.
>
> Acceptance criteria:
> - The person reviews the terms before applying; the old loan's payoff is confirmed

### Step 113: Balance transfers

> Read CLAUDE.md. Move card debt to 0%.
>
> Build:
> 1. 0% balance transfer offers (stand-in), the fee against interest saved, the payoff
>    needed before the promo ends, and a reminder before it does.
>
> Acceptance criteria:
> - The fee is always counted; the promo end date is never missed

### Step 114: Student loans

> Read CLAUDE.md. Student loans done right (demo advice).
>
> Build:
> 1. Repayment plans compared (standard, income-driven), forgiveness tracking (qualifying
>    payments counted), the official studentaid.gov steps as a guided flow.
>
> Acceptance criteria:
> - Plan math is in config with sources; every step links to the official page

### Step 115: Mortgage

> Read CLAUDE.md. The biggest loan, watched.
>
> Build:
> 1. Refinance break-even, extra principal payments, PMI removal when the home's value
>    (step 67) puts the loan under 80%, escrow changes spotted.
>
> Acceptance criteria:
> - PMI removal is raised once, with the steps; break-even math is tested

### Step 116: Credit score (stand-in)

> Read CLAUDE.md. Know the score and what moves it.
>
> Build:
> 1. A credit partner interface with a stand-in score and factors for the demo; what's
>    helping and hurting, and what Jane is doing about it (utilisation from card balances).
>
> Acceptance criteria:
> - The stand-in is labelled; nothing is pulled for a real account without the partner

### Step 117: Debt on autopilot

> Read CLAUDE.md. Debt runs itself.
>
> Build:
> 1. Payment reminders and due-date moves prepared by Jane, the payoff plan kept current,
>    rates watched; chat rule answers and Claude tools for every debt question.
>
> Acceptance criteria:
> - Step 87 gains debt questions and they score well

## Phase Z: taxes (steps 118–127)

Jane keeps the person's taxes organised all year, estimates what they'll owe, finds every
way to pay less, and gets everything ready to file.

### Step 118: Tax profile

> Read CLAUDE.md. What Jane needs to know.
>
> Build:
> 1. Filing status, dependants, state, income kinds (W-2, 1099, rental, investment),
>    worked out from transactions where possible and asked as a guided flow otherwise.
>
> Acceptance criteria:
> - Nothing is assumed silently; every answer can be changed

### Step 119: Tax organizer

> Read CLAUDE.md. Everything for tax time, all year.
>
> Build:
> 1. Tax tags on transactions (donations, medical, education, childcare, work expenses);
>    the documents to expect (W-2s, 1099s from payers seen in the income); the year-end
>    pack (step 72) with a summary and a spreadsheet.
>
> Acceptance criteria:
> - Tags never change spending totals; the pack matches the tags

### Step 120: Tax estimate

> Read CLAUDE.md. What they'll owe or get back, all year.
>
> Build:
> 1. Federal and state estimates from income so far and the profile, with 2026 brackets,
>    deductions and credits in config (marked for review); refund or amount owed, updated
>    after each sync.
>
> Acceptance criteria:
> - Every figure shows it's an estimate; config is tested against published examples

### Step 121: Withholding checkup

> Read CLAUDE.md. Not too much, not too little (demo advice).
>
> Build:
> 1. Compares withholding with the estimate; a big refund every year or a bill coming
>    means a W-4 change, with what to put and a guided flow.
>
> Acceptance criteria:
> - The suggestion moves the estimate toward zero owed and a small refund

### Step 122: Tax savings finder

> Read CLAUDE.md. Every way to pay less (demo advice).
>
> Build:
> 1. Findings from rules: retirement contributions, HSA and FSA room, itemizing vs the
>    standard deduction, bunching donations, student loan interest, education and energy
>    credits (from purchases seen), dependent care.
> 2. Each with an estimate, why, and the button that does it (start a goal for the
>    contribution, a task).
>
> Acceptance criteria:
> - Every estimate uses config rates and says it's an estimate

### Step 123: Self-employed

> Read CLAUDE.md. Freelancers' taxes handled (demo advice).
>
> Build:
> 1. Business expenses tagged, quarterly estimates calculated and reminded, a set-aside
>    amount from each payment (a goal by itself at the higher autopilot levels), home office
>    and mileage helpers.
>
> Acceptance criteria:
> - Quarterly amounts match the estimate; reminders come before each due date

### Step 124: Investment taxes

> Read CLAUDE.md. Gains and losses (demo advice; needs step 128).
>
> Build:
> 1. Realised and unrealised gains from holdings, tax-loss harvesting chances, wash-sale
>    warnings, which account to hold what in.
>
> Acceptance criteria:
> - Wash-sale rules are tested; gains match the holdings' cost basis

### Step 125: Refund tracker and what to do with it

> Read CLAUDE.md. When it lands and where it should go.
>
> Build:
> 1. The refund spotted when it arrives; demo advice on where it goes (emergency fund,
>    debt, goals), applied with one tap.
>
> Acceptance criteria:
> - The refund is matched to the estimate; nothing moves without a tap

### Step 126: File through a partner (stand-in)

> Read CLAUDE.md. From organised to filed.
>
> Build:
> 1. A tax filing partner interface with a stand-in: Jane hands over the profile, income,
>    tags and documents; the person reviews and signs; status tracked.
>
> Acceptance criteria:
> - Nothing is filed without the person's review and signature

### Step 127: Taxes on autopilot

> Read CLAUDE.md. Taxes run themselves.
>
> Build:
> 1. Tags, estimates, quarterly reminders and the year-end pack happen by themselves; one
>    message in January with everything ready; chat answers and tools for tax questions.
>
> Acceptance criteria:
> - Step 87 gains tax questions and they score well

## Phase AA: investments (steps 128–137)

Jane knows everything the person owns, what it costs, whether it fits their goals, and keeps
it on track, with one tap to act. Orders go through a stand-in brokerage until a brokerage
and a registered adviser partner are connected.

### Step 128: Holdings

> Read CLAUDE.md. What they own, in detail.
>
> Build:
> 1. Holdings in the demo bank (accounts, funds, shares, cost basis, expense ratios,
>    Plaid Investments-shaped); an investments page with balances by type and over time.
>
> Acceptance criteria:
> - Totals match net worth; every holding shows its source

### Step 129: Risk and goals

> Read CLAUDE.md. What the money is for.
>
> Build:
> 1. A short guided flow (age, when the money is needed, how a drop would feel, goals),
>    saved as a profile that later steps read.
>
> Acceptance criteria:
> - The profile can be changed any time; nothing uses it before it's answered

### Step 130: Fee finder

> Read CLAUDE.md. What investing costs them.
>
> Build:
> 1. Fund expense ratios, advisory and account fees, what they cost this year and over 30
>    years, and the lower-cost equivalent for each high-fee fund (demo advice).
>
> Acceptance criteria:
> - Every fee comes from the holdings data; 30-year math is tested

### Step 131: Portfolio review

> Read CLAUDE.md. Does it fit? (demo advice)
>
> Build:
> 1. Allocation against a target for the risk profile, diversification and concentration,
>    cash drag; recommendations with what changes and why.
>
> Acceptance criteria:
> - Recommendations follow the profile; nothing is promised about returns

### Step 132: Retirement planner

> Read CLAUDE.md. On track for retirement? (demo advice)
>
> Build:
> 1. A projection from balances and contributions, the 401(k) match captured or missed,
>    Roth or traditional, catch-up contributions, what to change to get on track.
>
> Acceptance criteria:
> - Assumptions are in config and shown; the projection is a range, never a promise

### Step 133: Rebalance with one tap (stand-in)

> Read CLAUDE.md. Approve and it's done.
>
> Build:
> 1. A brokerage partner interface (accounts, orders, confirmations) with a stand-in;
>    "move to the recommended mix" becomes simulated orders, shown before and after.
>
> Acceptance criteria:
> - The stand-in never touches real money and says so on every screen

### Step 134: Automatic investing (stand-in)

> Read CLAUDE.md. Investing without thinking about it.
>
> Build:
> 1. Recurring contributions (an amount every payday, the rest after bills and goals)
>    through the stand-in, paused by itself when safe to spend runs low.
>
> Acceptance criteria:
> - Never invests money safe to spend needs; every contribution is visible

### Step 135: Investment taxes and accounts

> Read CLAUDE.md. The right account for each dollar (demo advice).
>
> Build:
> 1. Which account to fill first (match, HSA, IRA, taxable), asset location, with step
>    124's tax view.
>
> Acceptance criteria:
> - The order is explained and changes with the profile

### Step 136: Learn

> Read CLAUDE.md. Plain explanations, one tap away.
>
> Build:
> 1. Short fixed explainers (index funds, fees, the match, Roth vs traditional,
>    rebalancing, refinancing, deductibles, the standard deduction), linked from answers
>    and cards; marked for counsel's review.
>
> Acceptance criteria:
> - Each explainer is reviewed text; every link resolves

### Step 137: Investments on autopilot

> Read CLAUDE.md. Investing runs itself.
>
> Build:
> 1. Drift watched and rebalancing prepared, contributions kept going, a monthly portfolio
>    note in the chat (no market predictions); chat answers and tools for investment
>    questions.
>
> Acceptance criteria:
> - Step 87 gains investment questions and they score well

## Phase AB: show Jane to more people (steps 138–140)

### Step 138: Try Jane without signing up

> Read CLAUDE.md. Visitors see Jane before they sign up.
>
> Build:
> 1. "Try it with sample data": a temporary demo person with the demo bank and demo advice,
>    deleted after a day; nothing contacts a company; rate-limited, never in metrics.
>
> Acceptance criteria:
> - A visitor can't reach anyone else's data; demo people are deleted on time

### Step 139: What Jane saved you

> Read CLAUDE.md. Proven savings.
>
> Build:
> 1. Confirmed savings with receipts, separate from estimates; a shareable total.
>
> Acceptance criteria:
> - Only savings seen in the person's transactions count as confirmed

### Step 140: Help inside the chat

> Read CLAUDE.md. New people learn Jane by using her.
>
> Build:
> 1. A short first-run conversation and a grouped "help", each with links.
>
> Acceptance criteria:
> - First-run shows once; every link resolves

## Phase AC: Jane runs the money (steps 141–148)

With every sector built, Jane can see and do a lot, but each sector still runs on its own
schedule and asks on its own. This phase makes her one controller: one nightly run across
everything, one ranked list of what matters, money that goes where it should by itself
(through stand-ins until a money-movement partner is connected), and fewer, better-timed
asks. The goal stays the founder's: as little from the person as possible.

### Step 141: One autopilot, every sector

> Read CLAUDE.md. One place to say how much Jane may do by herself.
>
> Build:
> 1. Autopilot per sector (subscriptions and bills, insurance, debt, taxes, investing,
>    goals and budgets) on top of step 57's level, each with a dollar cap per action and
>    per month, and "always ask" for anything over it.
> 2. Every sector's automation reads it through one helper; the chat explains and changes
>    it ("let Jane handle insurance up to $50 a month").
>
> Acceptance criteria:
> - No sector acts above its level or cap; changes take effect at once and are audited

### Step 142: The nightly controller run

> Read CLAUDE.md. Every check, every night, in the right order.
>
> Build:
> 1. One job per person each night that runs every sector's checks (sync, changes,
>    reshops, rates, tax estimate, portfolio drift, goals) in a fixed order with a time
>    budget, retries through the jobs table, and a log.
> 2. "What I checked last night" in the chat and on /jane, one line per sector.
>
> Acceptance criteria:
> - A failing sector never stops the others; the log shows what ran and what changed

### Step 143: The next best thing to do

> Read CLAUDE.md. One ranked list across everything.
>
> Build:
> 1. A priority engine: every open finding, recommendation and task scored by money saved
>    or gained per minute of the person's time, urgency and confidence (weights in config).
> 2. The brain, the morning brief and /jane use it, so the person always sees the one or
>    three things that matter most.
>
> Acceptance criteria:
> - The order is explained ("first because it saves the most and takes one tap"); tests
>   cover ties and deadlines

### Step 144: Money that moves itself (stand-in)

> Read CLAUDE.md. Paychecks split by themselves.
>
> Build:
> 1. A money-movement partner interface with a stand-in (like the demo bank): transfers
>    between the person's own accounts, scheduled and one-off.
> 2. A paycheck plan: after each paycheck, the amounts for bills, goals, the emergency
>    fund, debt extra payments, the tax set-aside and investing, kept above safe to
>    spend's cushion; moved by itself at the right autopilot level, otherwise one tap.
>
> Acceptance criteria:
> - Never moves money safe to spend needs; every transfer is visible and undoable while
>   pending; real money never moves without the partner and counsel

### Step 145: Bills paid on time (stand-in)

> Read CLAUDE.md. No late fees, ever.
>
> Build:
> 1. Bill pay through the money-movement stand-in: card minimums or statement balances and
>    regular bills scheduled before their due dates, within autopilot caps; due-date moves
>    suggested when a bill lands before payday.
>
> Acceptance criteria:
> - A payment is never scheduled that would overdraw an account in the forecast

### Step 146: Money health score

> Read CLAUDE.md. How the person is doing, in one number and a few lines.
>
> Build:
> 1. A score from cushion, debt, savings rate, cover, tax readiness and investing on track
>    (weights in config, explained), monthly, with the changes that would move it most.
>
> Acceptance criteria:
> - Every part of the score shows where it came from; it never shames, only says what helps

### Step 147: Asking less, at the right time

> Read CLAUDE.md. Jane learns when and how the person answers.
>
> Build:
> 1. Which messages the person acts on, when, and on which channel; Jane times her asks
>    and bundles to match, and stops kinds they never act on (with a note in Settings).
>
> Acceptance criteria:
> - Learning never silences urgent alerts or deadlines

### Step 148: The monthly money report

> Read CLAUDE.md. Everything Jane did, in one place, every month.
>
> Build:
> 1. A report in the chat and by email: saved, earned, paid down, moved, what's next, the
>    health score's change, with receipts (step 139).
>
> Acceptance criteria:
> - Every figure matches the pages it comes from

## Phase AD: insurance, all of it (steps 149–155)

Phase X handles the policies Jane already knows about. This phase makes her cover the rest:
every kind of insurance, the cover hiding in employer benefits and credit cards, policies
read from documents with no typing, and the events that change what someone needs, with
Jane doing the work and the person tapping once.

### Step 149: Every kind of cover

> Read CLAUDE.md. Insurance beyond car and home.
>
> Build:
> 1. Health (marketplace plans compared on premium plus expected out-of-pocket, open
>    enrollment dates as deadlines), disability, umbrella, pet, travel and device
>    protection, each in the profile, the quote engine (stand-in carriers) and the gap
>    rules.
> 2. In the chat: "Do I need umbrella insurance?" answered from their numbers (demo advice).
>
> Acceptance criteria:
> - Health plans compare total yearly cost, not just the premium; every kind has gap tests

### Step 150: Employer benefits

> Read CLAUDE.md. The cover that comes with the job.
>
> Build:
> 1. Benefits found from paycheck deductions (health, life, disability, FSA and HSA) and a
>    short guided flow for the rest; compared with buying the same cover privately; open
>    enrollment as a deadline with Jane's recommendation ready (demo advice).
>
> Acceptance criteria:
> - Deductions are matched to benefits only with confirmation; the comparison is like for
>   like

### Step 151: Policies read from documents

> Read CLAUDE.md. No typing: Jane reads the policy.
>
> Build:
> 1. Uploaded declarations pages and renewal notices (step 68) read into policy records:
>    carrier, cover limits, deductibles, premium, renewal, with Claude extraction checked by
>    rules and shown for a one-tap confirm; without a key, the fields to fill are prefilled
>    from the payments.
>
> Acceptance criteria:
> - Nothing extracted is saved without the confirm tap; every field shows where it came from

### Step 152: Cover you already have

> Read CLAUDE.md. Stop paying twice.
>
> Build:
> 1. A card-benefits catalog (stand-in, reviewed by the team): rental car cover, phone
>    protection, extended warranty, travel insurance; duplicates found against what the
>    person pays for (device protection plans, rental add-ons, extended warranties) and
>    cancelled through the usual one-tap flow.
>
> Acceptance criteria:
> - A duplicate is only raised when the card benefit really covers it, with the benefit's
>   limits shown

### Step 153: Life insurance, sized and bought

> Read CLAUDE.md. The right amount of life cover (demo advice).
>
> Build:
> 1. A needs calculation (income replacement, debts, dependants, existing cover) with the
>    method shown, term quotes from the engine, and one-tap apply through the partner
>    stand-in, with the health questions as a guided flow.
>
> Acceptance criteria:
> - The amount and term are explained; nothing is applied for without a tap

### Step 154: When life changes, cover changes

> Read CLAUDE.md. Jane updates cover after events.
>
> Build:
> 1. A car bought, a move, a new baby, a marriage, a new job (step 100 and payments): Jane
>    prepares the cover change (add the car, move the renters policy, add a dependant,
>    review life cover) and asks once.
>
> Acceptance criteria:
> - Every event has a test; nothing changes without the tap the autopilot level needs

### Step 155: Renewal negotiation and claims, done by Jane

> Read CLAUDE.md. Jane calls and files.
>
> Build:
> 1. Before a renewal with a price rise, Jane asks the carrier for a better rate (step 54's
>    call flow, through the partner stand-in) and reshops in parallel.
> 2. Small claims filed through the partner stand-in from the claims helper (step 107),
>    with status tracked in the chat.
>
> Acceptance criteria:
> - Calls stay within the person's limits; a claim is never filed without their review

## Phase AE: investing, all of it (steps 156–164)

Phase AA built the core: holdings, a risk profile, fees, a review, retirement, one-tap
rebalancing and automatic contributions. This phase makes Jane a full investing manager:
prices and real returns, every goal invested for its own timeline, the special accounts
(college, HSA, company stock, crypto), cash done right, a steady hand when markets drop,
and a fully automatic mode within the person's limits. All advice is demo advice; orders
and prices go through stand-ins until a brokerage, market-data and adviser partner are
connected.

### Step 156: Prices and real returns

> Read CLAUDE.md. What the investments are worth and how they've done.
>
> Build:
> 1. A market-data partner interface with a stand-in daily price feed for the demo
>    holdings; values refreshed by the nightly run.
> 2. Returns that count contributions properly (time-weighted and money-weighted),
>    dividends and interest received, against a simple benchmark for their mix; on the
>    investments page and in the chat ("how are my investments doing?").
>
> Acceptance criteria:
> - Returns math is tested against worked examples; no predictions anywhere

### Step 157: Every goal invested for its timeline

> Read CLAUDE.md. Money for each goal, invested to match when it's needed (demo advice).
>
> Build:
> 1. Each goal (house, car, wedding, retirement) gets a bucket: cash for under 3 years,
>    a mix that gets safer as the date nears (a glide path in config) for longer ones.
> 2. Jane moves new money to the right bucket by itself at the right autopilot level.
>
> Acceptance criteria:
> - A near-term goal is never put in stocks; the glide path is shown and tested

### Step 158: College savings

> Read CLAUDE.md. Saving for a child's education (demo advice).
>
> Build:
> 1. A cost projection (in config, with sources), a 529 plan comparison stand-in (fees,
>    state tax benefit from the tax profile), a monthly amount to get there, set up as a goal
>    with automatic contributions.
>
> Acceptance criteria:
> - The state benefit uses the tax profile's state; amounts are ranges, never promises

### Step 159: HSA as an investment

> Read CLAUDE.md. The account with three tax breaks (demo advice).
>
> Build:
> 1. HSA balance invested beyond a cash cushion, contributions up to the limit, and a
>    receipts vault: medical charges found in transactions saved for later reimbursement.
>
> Acceptance criteria:
> - Limits come from config with sources; every saved receipt links to its transaction

### Step 160: Company stock

> Read CLAUDE.md. RSUs, ESPP and options without too many eggs in one basket (demo advice).
>
> Build:
> 1. Vesting and purchases from a guided flow or paycheck lines; concentration measured;
>    a sell-and-diversify plan with the tax cost (step 124) and a schedule.
>
> Acceptance criteria:
> - The plan shows the tax cost and the risk it removes; nothing is sold without a tap

### Step 161: Crypto, read-only

> Read CLAUDE.md. See it, size it, never trade it.
>
> Build:
> 1. Crypto balances through a stand-in exchange or wallet connection (read-only),
>    included in net worth and the mix; concentration and fee flags (demo advice); no
>    trading, ever.
>
> Acceptance criteria:
> - No order path exists for crypto; balances are labelled with their source and time

### Step 162: Cash done right

> Read CLAUDE.md. Every dollar of cash earning what it should (demo advice).
>
> Build:
> 1. Cash across checking, savings and brokerage sweep compared with high-yield savings,
>    money market funds and a Treasury ladder (stand-in rates with dates); the emergency
>    fund kept liquid; one-tap moves through the money-movement stand-in.
>
> Acceptance criteria:
> - The emergency fund is never put somewhere it can't be reached in days

### Step 163: A steady hand

> Read CLAUDE.md. When markets drop, Jane keeps the plan.
>
> Build:
> 1. A big drop in the portfolio triggers one calm message: what changed, what it means
>    for their goals' timelines, and the plan; a pause before any sell they start, with the
>    long-term cost shown. No market predictions, ever.
>
> Acceptance criteria:
> - Never says what markets will do; the pause can always be skipped

### Step 164: Fully automatic investing

> Read CLAUDE.md. Investing that runs itself, within limits.
>
> Build:
> 1. At "handle everything" with an investing cap, Jane contributes, rebalances, invests
>    new cash and harvests losses (step 124) through the stand-in brokerage by herself,
>    posting one summary a month; everything above the cap asks first.
>
> Acceptance criteria:
> - Nothing over the cap happens without a tap; every action is in the log with its reason

## Phase AF: taxes, all of it (steps 165–173)

Phase Z gave Jane the core of taxes: profile, organizer, estimate, withholding, savings,
freelancers, investment taxes, refunds, filing and autopilot. This phase covers everyone's
real situation: states, documents that arrive by themselves, a year-round plan, giving,
families, homes, records that survive an audit, last year's return, and side income. All
recommendations are demo advice; figures live in config, marked for review, with sources.

### Step 165: State and local taxes

> Read CLAUDE.md. Every state someone lived or worked in.
>
> Build:
> 1. Part-year and multi-state situations (a move, remote work for an out-of-state
>    employer), state credits and local income taxes, in the estimate and the pack, with
>    state figures in config per state (the states the demo uses first, the rest marked to
>    add).
>
> Acceptance criteria:
> - A mid-year move splits income correctly; each state's figures cite their source

### Step 166: Tax documents that collect themselves

> Read CLAUDE.md. W-2s and 1099s, gathered by Jane.
>
> Build:
> 1. A tax-document partner interface with a stand-in (payroll and brokerage forms for the
>    demo): forms fetched when available, matched to the expected list (step 119), amounts
>    checked against the transactions, missing ones chased with a reminder.
>
> Acceptance criteria:
> - A form that disagrees with the transactions is flagged, never silently used

### Step 167: The year-round tax plan

> Read CLAUDE.md. The right move at the right time.
>
> Build:
> 1. A calendar of tax moves with their deadlines (retirement and HSA contributions,
>    estimated payments, December harvesting, giving before year-end, the W-4 after a life
>    event), each prepared by Jane and done by herself at the right autopilot level.
>
> Acceptance criteria:
> - Every move has a deadline from config; nothing past its deadline is offered

### Step 168: Giving, done smart

> Read CLAUDE.md. More good for the same money (demo advice).
>
> Build:
> 1. Donations found and receipted, bunching years compared with the standard deduction,
>    giving appreciated shares instead of cash (with step 124), a donor-advised fund
>    stand-in.
>
> Acceptance criteria:
> - The comparison shows the tax with and without each option

### Step 169: Family taxes

> Read CLAUDE.md. Kids, care and school (demo advice).
>
> Build:
> 1. The child tax credit, dependent care FSA versus the credit, education credits (which
>    one fits), 529 benefits from step 158, and filing status choices for couples.
>
> Acceptance criteria:
> - Each choice shows both sides' tax; eligibility rules are tested

### Step 170: Homeowner taxes

> Read CLAUDE.md. What a home changes at tax time (demo advice).
>
> Build:
> 1. Mortgage interest and property tax (with the state and local tax cap), points, the
>    home office, energy credits from purchases seen, and the gain on a sale tracked
>    against the exclusion.
>
> Acceptance criteria:
> - The cap is applied; every figure links to its transactions or documents

### Step 171: Audit-ready records

> Read CLAUDE.md. Proof for everything claimed.
>
> Build:
> 1. Every deduction and credit tied to its transactions, receipts and documents; an audit
>    pack per year; how long to keep what, with reminders before deleting.
>
> Acceptance criteria:
> - Nothing in the pack lacks its source; retention follows config

### Step 172: Last year's return, reviewed

> Read CLAUDE.md. Money left behind last year (demo advice).
>
> Build:
> 1. An uploaded prior-year return read (with confirm, like step 151) and checked against
>    what Jane knows: missed deductions or credits, and an amended return prepared through
>    the filing stand-in when it's worth it.
>
> Acceptance criteria:
> - Nothing is amended without the person's review and signature

### Step 173: Side income and rentals

> Read CLAUDE.md. Income beyond the paycheck (demo advice).
>
> Build:
> 1. Rental income and expenses, depreciation basics, gig income from platform payouts,
>    hobby versus business, all in the estimate, the quarterly amounts and the pack.
>
> Acceptance criteria:
> - Platform payouts are matched to their 1099s; depreciation math is tested

## Phase AG: credit and borrowing, all of it (steps 174–181)

Phase Y handles the debts someone has. This phase covers the rest of credit: the right card
for each purchase, building credit, buy-now-pay-later under control, help when money is
tight, big purchases planned before the loan, medical bills, and collections. Partners are
stand-ins; advice is demo advice.

### Step 174: The right card for each purchase

> Read CLAUDE.md. Rewards without the fees (demo advice).
>
> Build:
> 1. A card catalog stand-in (rewards, annual fees, intro offers); which of their cards to
>    use for each kind of spending, whether each annual fee pays for itself, and a better card
>    when one would earn more, applied for through the partner stand-in with one tap.
>
> Acceptance criteria:
> - Rewards use the person's own spending; the fee is always counted

### Step 175: Building credit

> Read CLAUDE.md. A better score, step by step.
>
> Build:
> 1. Paying before the statement date to lower utilisation (reminders or automatic through
>    the money-movement stand-in), on-time streaks, a credit-builder product stand-in for thin
>    files, and a score simulator for each change.
>
> Acceptance criteria:
> - The simulator is labelled an estimate; nothing changes a real account

### Step 176: Buy now, pay later under control

> Read CLAUDE.md. Every installment, seen and planned.
>
> Build:
> 1. All plans with their next installments in the forecast and safe to spend, a warning
>    before a new plan would strain the month, and paying off early when it's free.
>
> Acceptance criteria:
> - Installments match the plans' schedules; the warning uses the forecast

### Step 177: When money is tight

> Read CLAUDE.md. Help before it goes wrong.
>
> Build:
> 1. When the forecast shows a shortfall, Jane prepares the options: due-date moves,
>    hardship programs and lower rates asked for (the call flow, through stand-ins), late
>    fees waived, which bills to pay first, as one plan with one tap per item.
>
> Acceptance criteria:
> - Essentials (housing, utilities, insurance) come first; every request needs a tap

### Step 178: Buying a car

> Read CLAUDE.md. The loan sorted before the dealer (demo advice).
>
> Build:
> 1. What they can afford, preapproval offers compared (lender stand-in), the dealer's
>    financing checked against them, and the insurance cost included (Phase AD).
>
> Acceptance criteria:
> - Affordability includes insurance and running costs; offers compare total cost

### Step 179: Buying a home

> Read CLAUDE.md. From saving to closing (demo advice).
>
> Build:
> 1. Affordability, a down-payment goal invested for its date (step 157), mortgage
>    preapproval offers compared (stand-in), closing costs estimated, and PMI explained.
>
> Acceptance criteria:
> - The plan uses their real cash flow; every assumption is shown

### Step 180: Medical bills

> Read CLAUDE.md. Pay less for care already received.
>
> Build:
> 1. Medical bills found, checked against insurance (Phase AD), financial-assistance
>    applications and itemized-bill requests drafted, payment plans at zero interest, all
>    sent with a tap.
>
> Acceptance criteria:
> - Nothing is sent to a provider without a tap; amounts match the bills

### Step 181: Collections and credit report errors

> Read CLAUDE.md. Fix what's wrong on the report.
>
> Build:
> 1. Collections and errors found through the credit partner stand-in, validation and
>    dispute letters drafted, deadlines tracked, results followed up in the chat.
>
> Acceptance criteria:
> - Every letter cites the right rule and deadline from config; nothing is sent without a
>   tap

## Phase AH: Jane the agent, round two (steps 182–188)

Phase V made the chat professional. This round makes Jane the one place the person needs:
she gets payday right, answers across every sector at once, runs the day in one message,
takes requests that span several sectors, can be talked to, shows everything she did, and
fits how each person likes to be spoken to.

### Step 182: Paydays that are right

> Read CLAUDE.md. Fix the payday Jane plans around.
>
> Build:
> 1. Paychecks detected for every common schedule (weekly, every two weeks, twice a month on
>    fixed dates like the 1st and 15th with weekend and holiday shifts, monthly), from
>    payroll-like deposits only; small interest or refunds are never a paycheck.
> 2. Safe to spend, the forecast, the brief and every sector that reads the payday use it.
>
> Acceptance criteria:
> - The demo bank's 1st-and-15th payroll is found and $1.02 of interest never is; each
>   schedule has tests with shifted dates

### Step 183: Answers across everything

> Read CLAUDE.md. "Am I OK?" and "what should I do this month?" answered whole.
>
> Build:
> 1. Rule answers and a Claude tool that pull from every sector at once: the ranked list
>    (step 143), the health score (step 146), what's due, what Jane is doing; one answer
>    with the one to three things that matter and their buttons.
>
> Acceptance criteria:
> - Step 87 gains whole-picture questions and they score well; figures match each sector

### Step 184: The day in one message

> Read CLAUDE.md. One morning message runs the day.
>
> Build:
> 1. The brief becomes the day's agenda: what Jane did overnight (step 142), what needs a
>    yes (with "approve all safe ones"), what's coming up, each a line with its button;
>    nothing else from Jane until something urgent.
>
> Acceptance criteria:
> - A day with nothing to do gets one short line; urgent things still come at once

### Step 185: Requests that span sectors

> Read CLAUDE.md. "Switch my car insurance and put the savings in my emergency fund."
>
> Build:
> 1. Requests that need several actions become one plan: each step through its feature's
>    own code, shown together for one confirmation, done in order, with what happened after
>    each and undo where the feature has it.
>
> Acceptance criteria:
> - Nothing runs before the confirmation; a failed step stops the rest and says why

### Step 186: Talk to Jane

> Read CLAUDE.md. Speak instead of typing.
>
> Build:
> 1. A microphone button in the message box (the browser's speech recognition where
>    available, the existing /api/voice route otherwise) and answers read aloud on request;
>    the words go through the same rules and guardrails as typing.
>
> Acceptance criteria:
> - Works with a keyboard and a screen reader; nothing is recorded or stored beyond the
>   text sent

### Step 187: Everything Jane did

> Read CLAUDE.md. A full, honest record.
>
> Build:
> 1. An activity timeline in the chat and on /jane: every action Jane took by herself or on
>    a tap, across sectors, with why, the money involved and undo while it works; "why did
>    you do that?" answered from it.
>
> Acceptance criteria:
> - Every autopilot action appears with its reason; nothing is missing against the audit
>   log

### Step 188: Jane's way of talking

> Read CLAUDE.md. Short or detailed, as the person likes.
>
> Build:
> 1. Preferences (step 91) for answer length, how often Jane posts, and plain or numbers-
>    first, picked up from what the person says ("keep it short") and set in Settings; the
>    templates and Claude's instructions follow them.
>
> Acceptance criteria:
> - The answer shape (step 89) holds at every length; step 87's scores hold

## Phase AI: Jane's chat, smooth (steps 189–195)

Ten sectors each added their own phrases, replies and tools to the chat, and the rules
answer first: a question worded a little differently falls through to three generic
buttons, sectors collide over the same words, and Claude's answers have never been graded.
This round is about quality, not new features. Jane understands anything about the
person's money, answers it right, and feels quick and calm to use. Claude reads every free-text
message and works through every sector's tools; the rules stay for button taps and as the
backup when Claude is unavailable (see "Chat architecture" at the end of this file, which
replaces rules-first). Every change is measured on one question bank.

### Step 189: The question bank

> Read CLAUDE.md. Measure the chat before changing it.
>
> Build:
> 1. Grow step 87's bank to at least 400 everyday questions across every sector and page,
>    worded the way people talk (typos, follow-ups, two questions at once), including every
>    question the QA report found unanswered ("what's my net worth", "why is my checking
>    going negative", "what about my HSA", "move $200 to savings"...). Each has the tool or
>    rule it should reach, the figures the answer must contain and the guardrail profile.
> 2. One script scores it: understood (no generic fallback), right route, right figures,
>    guardrails pass, time to first words. The rules run with no key. The Claude part runs
>    when ANTHROPIC_API_KEY is set and is skipped (and says so) otherwise.
> 3. Today's scores recorded in docs/chat-quality.md as the baseline.
>
> Acceptance criteria:
> - Every sector and every page has questions; the script runs in under five minutes with
>   no key; the baseline is committed

### Step 190: One registry for the chat

> Read CLAUDE.md. Make the chat code simple enough to get right.
>
> Build:
> 1. Every sector's intents, replies, buttons and Claude tools registered in one place, one
>    entry per capability (what it answers, its tool, its reply, its buttons), in place of
>    the scattered intent and reply files. Duplicates merged.
> 2. A test that no two capabilities claim the same phrase, and that every capability has a
>    tool and questions in the bank.
>
> Acceptance criteria:
> - The bank's scores don't drop; the chat code is smaller; adding a capability touches one
>   file plus its own feature

### Step 191: Claude first

> Read CLAUDE.md. Free text goes to Claude with every tool.
>
> Build:
> 1. Every typed or spoken message goes to Claude with the registry's tools and the
>    person's context (step 92). Button taps and exact commands ("approve all", "pause")
>    keep the instant rule path. With no key, or when Claude is slow or down, the rules
>    answer as today.
> 2. Figures come only from tool results; the guardrails (and demo_advice in advice mode)
>    run on every answer; a daily cost cap per person lives in src/config/agent-chat.ts.
> 3. Answers stream, so the first words show within about a second and a half.
>
> Acceptance criteria:
> - With a key, the bank's understood rate is at least 95% and right figures 100%; with no
>   key, nothing is worse than before

### Step 192: A tool for everything

> Read CLAUDE.md. Anything on a page can be asked in the chat.
>
> Build:
> 1. Walk every page and feature: each has a tool that reads it and, where the page acts,
>    a tool that proposes the action as a card (never runs it without the usual tap or
>    autopilot rule). Fill the gaps the bank shows: net worth, HSA, giving, student loans,
>    card interest, why checking goes negative, moving money (queued for the team), budgets.
>
> Acceptance criteria:
> - Every page has a bank question that's answered from its tool with the page's figures

### Step 193: Conversations that flow

> Read CLAUDE.md. Jane follows the conversation.
>
> Build:
> 1. Follow-ups use what was just said ("what about the other one", "do it", "and for my
>    wife's car?"); the topic carries until it changes. When Jane isn't sure, she asks one
>    short question with the likely choices, never the three generic buttons when a tool
>    fits. Two questions in one message get both answers.
>
> Acceptance criteria:
> - The bank's follow-up and two-part questions score at least 90%

### Step 194: Smooth to use

> Read CLAUDE.md. The chat feels quick and calm.
>
> Build:
> 1. No lost clicks while messages arrive (buttons and links work during refresh and
>    streaming), no jumping scroll, a typing indicator, the message box right on phones
>    with the keyboard open, plain errors with a retry, nothing posted twice.
> 2. Fix every chat bug in the QA report and the flaky chat end-to-end tests; the chat specs
>    pass ten runs in a row.
>
> Acceptance criteria:
> - The chat e2e specs pass 10/10 in CI; phone and desktop checked in light and dark

### Step 195: Graded every night

> Read CLAUDE.md. Quality can only go up.
>
> Build:
> 1. A scheduled GitHub Action runs the bank nightly (the Claude part when the
>    ANTHROPIC_API_KEY secret is set), writes the scores to docs/chat-quality.md and opens
>    an issue when a score drops. The rules part runs on every PR that touches the chat and
>    fails it on a drop.
> 2. /admin shows the scores over time and the questions that failed.
>
> Acceptance criteria:
> - A deliberately broken intent fails the PR check; a night's scores appear on /admin

## Phase AJ: insurance, round three (steps 196–202)

Phases X and AD find, buy, switch and claim on every kind of cover. This round makes Jane
cut what the person pays for the cover they keep, spot risks from how they actually live,
cover the whole household, and help decide when to claim. Each step is built into the chat
through the registry from step 190 (one entry per capability, with bank questions from
step 189).

### Step 196: Paying less for the same cover

> Read CLAUDE.md. Savings without switching.
>
> Build:
> 1. For each policy, rules find the cheaper way to pay for the same cover: pay in full vs
>    monthly (installment fees from payments), autopay and paperless discounts, bundling
>    car and home with one carrier, safe-driver or telematics offers, a higher deductible
>    when savings cover it (shown both ways, rates in src/config/insurance.ts). The partner
>    stand-in applies each change; a tap confirms.
>
> Acceptance criteria:
> - Each saving shows the yearly figure and what changes; cover never drops without saying
>   so; every rule has tests

### Step 197: Risks seen in how you live

> Read CLAUDE.md. Gaps spotted from transactions, asked about once.
>
> Build:
> 1. Signals in transactions, each a rule: rideshare or delivery income (personal car
>    policy may not cover it), a home business, a new dog, an expensive ring or camera
>    (worth listing on the policy), a boat or second home, renting the home out. Each
>    becomes one question in the chat ("Are you driving for Uber?"), then a gap with quotes
>    if the answer is yes. A no is remembered.
>
> Acceptance criteria:
> - The demo bank has one signal of each kind; each is asked once and never again after a
>   no

### Step 198: The whole household's cover

> Read CLAUDE.md. Everyone in the house in one view.
>
> Build:
> 1. Household members (step 25) see shared policies once, each person's own policies, and
>    who is covered by what (spouse on the health plan, teen drivers on the car). Gaps per
>    person: a new teen driver, a dependant with no life cover behind them, a partner's
>    employer plan that's cheaper for the family.
> 2. Partners only see what they share, as today.
>
> Acceptance criteria:
> - The sharing rules hold (tests); a family health plan comparison counts both employers'
>   plans

### Step 199: Claim or pay yourself?

> Read CLAUDE.md. Help deciding whether a claim is worth it.
>
> Build:
> 1. Before a claim (step 107 and 155's filing), Jane shows the payout after deductible
>    against the likely premium rise over three years (config surcharge rates per claim
>    kind), and the claims-free discount at risk; demo advice only, the facts on real
>    accounts.
>
> Acceptance criteria:
> - A small claim under the deductible says so; the three-year figure is tested for each
>   kind

### Step 200: Health cover all year

> Read CLAUDE.md. Get the most out of the health plan they have.
>
> Build:
> 1. From transactions and the plan: deductible and out-of-pocket so far this year, the
>    month they'll hit the maximum, HSA or FSA money left and the use-it-or-lose-it date,
>    in-network checks against the plan's stand-in directory, and big bills checked
>    against what the plan should have paid (a dispute card for the team).
>
> Acceptance criteria:
> - The demo year shows deductible progress and an FSA deadline; a bill above the plan's
>   share opens a dispute card

### Step 201: Business and side-gig cover

> Read CLAUDE.md. Cover for what people earn on the side.
>
> Build:
> 1. Self-employed or gig income (step 123's signals) brings business cover into the
>    profile: general liability, professional liability, business use on the car, equipment;
>    quotes from the stand-in partner, gaps by rules, in the checkup.
>
> Acceptance criteria:
> - Personal policies are never presented as covering business use; each kind has tests

### Step 202: Insurance on autopilot, round two

> Read CLAUDE.md. One yearly insurance review, done for them.
>
> Build:
> 1. Once a year (and after a life event) Jane runs every check from this phase and
>    Phase AD together and sends one message: what she did by herself within the caps,
>    what needs a tap, and the yearly money involved. "Keep me covered" handles renewals,
>    payment plans and discounts at "Everything allowed".
> 2. Every insurance capability in the registry, with bank questions that score well.
>
> Acceptance criteria:
> - The review message is one message with every item's button; nothing price-changing
>   happens without a tap below "Everything allowed"

## Phase AK: Jane runs the money, round two (steps 203–209)

Phase AC gave Jane one autopilot, a nightly run, a ranked next step, bills paid on time and
a monthly report. This round has her plan the year, handle what life throws at the person,
notice what's unusual, learn what works for each person, and show the long view. Each step
is built into the chat through the step 190 registry, with questions in step 189's bank.

### Step 203: What if

> Read CLAUDE.md. "What if I lose my job?" answered across everything.
>
> Build:
> 1. Scenarios (job loss, a raise, a baby, moving, buying a car or a home, going part-time)
>    run through every sector's own numbers: the forecast, goals, debt plan, insurance
>    needs, taxes and investing, month by month, with Jane's plan for it. One tap adopts
>    the plan's changes as proposals (step 143), never actions.
>
> Acceptance criteria:
> - Each scenario's figures match each sector's own calculation; nothing changes without
>   the usual taps

### Step 204: When income stops

> Read CLAUDE.md. A missed paycheck switches Jane into a lean plan.
>
> Build:
> 1. When an expected paycheck (step 182) doesn't arrive within its window, Jane asks once,
>    then on a yes: pauses automatic transfers (step 144), lists bills that can wait,
>    hardship programs for each loan and card (stand-in catalog), the unemployment guide
>    for their state, and the runway the emergency fund gives. All of it goes in one
>    message, and Jane goes back to normal when pay resumes.
>
> Acceptance criteria:
> - A late paycheck within its window never triggers it; the runway uses the forecast

### Step 205: The year's money plan

> Read CLAUDE.md. Twelve months, planned, then kept up.
>
> Build:
> 1. A yearly plan with monthly targets from every sector (saving, paying down debt,
>    investing, insurance renewals, tax payments and deadlines) that fits the forecast,
>    re-planned each month from what really happened, shown in the monthly report (step
>    148) and on /plan.
>
> Acceptance criteria:
> - The months add up to the year; a missed month moves the rest, never the past

### Step 206: Every paycheck sent where it should go

> Read CLAUDE.md. Money that moves itself, round two.
>
> Build:
> 1. Each paycheck split by the plan's priorities (buffer from the forecast first, then bills,
>    goals, debt and investing) through step 144's stand-in, within the autopilot caps,
>    with one line in the chat saying where every dollar went and undo while it works.
>
> Acceptance criteria:
> - The buffer never drops below the forecast's lowest point plus the config margin

### Step 207: What worked

> Read CLAUDE.md. Jane learns from results.
>
> Build:
> 1. Every action's result checked against later transactions (did the bill really drop,
>    did the fee stop), proven savings per kind, and what each person says yes to; the
>    ranking (step 143) and how often Jane asks (step 147) use it; "what worked" in the
>    monthly report.
>
> Acceptance criteria:
> - An action whose saving never shows up is marked so and stops counting as saved

### Step 208: Spotting the unusual

> Read CLAUDE.md. Charges that don't look right, caught the same day.
>
> Build:
> 1. Rules across every account: a charge far above usual for that merchant, a large first
>    charge from a new merchant, a bill much higher than usual, a refund that never arrived,
>    a subscription charged twice in a month. Each becomes one alert with "this was me" and
>    "not me". "Not me" opens a dispute card for the team and the card's lock steps.
>
> Acceptance criteria:
> - Thresholds live in src/config/detection.ts; "this was me" teaches the rule for that
>   merchant

### Step 209: The long view

> Read CLAUDE.md. Where the money is heading over decades.
>
> Build:
> 1. Net worth projected at 10, 20 and 30 years from every sector's plan (debt payoff,
>    investing, home value, insurance, taxes), retirement readiness (demo advice), and what
>    moves it most, each with its button.
>
> Acceptance criteria:
> - Assumptions shown and editable; rates in config; real accounts get the facts without
>   advice

## Phase AL: investing, round three (steps 210–216)

Phases AA and AE hold, review, rebalance and invest automatically for every goal. This
round covers the accounts and decisions that decide most people's retirement: workplace
plans and IRAs used fully, old accounts brought home, income in retirement, family
accounts, property as an investment, what costly products really cost, and one yearly
review done for them. Recommendations are demo advice; limits and rates live in config with
sources. Each step is built into the chat through the step 190 registry, with questions in
step 189's bank.

### Step 210: Retirement accounts used fully

> Read CLAUDE.md. Every match and every limit, used.
>
> Build:
> 1. From pay (step 150's benefits and paychecks) and contributions: the employer match
>    left on the table, traditional or Roth by bracket (step 120's estimate), contribution
>    limits tracked across every account with catch-up at 50, and backdoor Roth when income
>    is over the limit. Each is a card: the change to the payroll percentage goes to the
>    team or the payroll stand-in, and IRA contributions go through the stand-in brokerage.
>
> Acceptance criteria:
> - Limits from config with the year and source; a missed match shows the yearly dollars

### Step 211: Old accounts brought home

> Read CLAUDE.md. Forgotten 401(k)s found and rolled over.
>
> Build:
> 1. Past employers from payroll history and the person's answers, each asked once ("Did
>    you have a 401(k) at Acme?"). Found accounts are added read-only, with their fees
>    compared (step 130), and a rollover guide plus a stand-in rollover (direct, never a
>    check to the person) with every step tracked.
>
> Acceptance criteria:
> - A rollover never counts as a withdrawal; fees compared before and after

### Step 212: Income in retirement

> Read CLAUDE.md. Turning savings into a paycheck.
>
> Build:
> 1. For people within 15 years of retirement or in it: Social Security at 62, full age and
>    70 (from their statement or an estimate they enter), the order to draw from accounts,
>    required minimum distributions, and a monthly retirement paycheck that lasts, with
>    the forecast and taxes (demo advice).
>
> Acceptance criteria:
> - RMD ages and tables from config with sources; each plan shows how long the money lasts

### Step 213: Investing for the family

> Read CLAUDE.md. Children's and family accounts.
>
> Build:
> 1. Custodial accounts, a Roth IRA for a teenager with earned income, and gifts from
>    grandparents into a child's 529 (step 158) through a share link that never shows the
>    parents' money. Each sits under the household's goals.
>
> Acceptance criteria:
> - A gift link shows only the goal and its progress; the household sharing rules hold

### Step 214: Property as an investment

> Read CLAUDE.md. Homes and rentals counted properly.
>
> Build:
> 1. Home equity in net worth and in the long view, and rental properties from
>    transactions (rent in, mortgage, repairs, property tax): profit per property, the
>    return on the cash put in, depreciation handed to the taxes side (step 173), and
>    whether paying the mortgage down beats investing (demo advice).
>
> Acceptance criteria:
> - A rental's figures match its transactions; the comparison shows both sides

### Step 215: What costly products really cost

> Read CLAUDE.md. Annuities, whole life and advisor fees, in dollars.
>
> Build:
> 1. Variable annuities, whole life cash value and advisory accounts found from statements
>    and payments: the yearly cost in dollars, surrender charges by year, what the same
>    money would do in low-cost funds, and when getting out costs less than staying.
>    Never "cancel now" without the surrender figures.
>
> Acceptance criteria:
> - The fee and surrender math has tests; nothing is recommended on real accounts

### Step 216: Investing on autopilot, round two

> Read CLAUDE.md. One yearly investing review, done for them.
>
> Build:
> 1. Once a year (and after a raise or a new job) one message covering contributions
>    against limits, the match, rollovers, rebalancing, tax-loss harvesting, fees and every
>    goal on track: what Jane did within the caps and what needs a tap.
> 2. Every investing capability in the registry, with bank questions that score well.
>
> Acceptance criteria:
> - One message with every item's button; nothing above the cap without a tap

## Phase AM: taxes, round three (steps 217–223)

Phases Z and AF estimate, plan, organize and file, for every common situation. This round
handles what goes wrong and what pays off over years: letters from the IRS, a stolen tax
identity, crypto and equity pay, moves planned across several years, property tax that's
too high, working with an accountant, and a tax year that runs itself. Recommendations are
demo advice; figures live in config with sources. Each step is built into the chat
through the step 190 registry, with questions in step 189's bank.

### Step 217: Letters from the IRS and the state

> Read CLAUDE.md. A scary letter, explained and answered.
>
> Build:
> 1. A photographed or uploaded notice (step 166's tax documents) read by Claude: which notice it
>    is (CP2000, CP14, CP501, state equivalents), what it says is owed and by when, and a
>    check against what Jane knows (the return, forms, payments). It becomes a deadline
>    and a drafted response (agree, pay, or dispute with the documents attached), sent by
>    the team or by the person.
>
> Acceptance criteria:
> - Notice kinds and deadlines from config with sources; nothing is paid or sent without
>   a tap

### Step 218: A protected tax identity

> Read CLAUDE.md. Tax identity theft caught and handled.
>
> Build:
> 1. Every January, a reminder and guide to get an IRS Identity Protection PIN. When there's
>    a sign of theft (a rejected e-file because a return was already filed, a W-2 or 1099
>    from an unknown payer, an IRS letter about a return they didn't file), Jane gives the
>    steps in order (Form 14039 guide, a credit freeze through the loans lane's credit
>    pages, the IRS phone line) and tracks each one.
>
> Acceptance criteria:
> - Each sign has a test; the steps are tracked to done

### Step 219: Crypto and equity pay, taxed right

> Read CLAUDE.md. The tricky income, worked out.
>
> Build:
> 1. Crypto gains and losses from step 161's holdings (cost basis by lot, the 1099-DA once it
>    arrives), ESPP sales that lost their special treatment, ISO exercises with an AMT
>    estimate, and RSU withholding that falls short of the real rate, all in the tax
>    estimate with a "set aside" amount and its button.
>
> Acceptance criteria:
> - AMT and holding-period rules from config with sources; each case has tests

### Step 220: Tax moves over several years

> Read CLAUDE.md. Paying less tax over a decade, not just this year.
>
> Build:
> 1. A multi-year projection from every sector's plan, with the moves it finds: Roth
>    conversions in low-income years, filling the 0% capital gains bracket, bunching
>    deductions into alternate years, timing a bonus, a sale or a retirement withdrawal.
>    Each move shows its lifetime tax effect, and the investing side carries it out (demo
>    advice).
>
> Acceptance criteria:
> - Brackets per year from config; the projection's first year matches step 120's estimate

### Step 221: Property tax that's too high

> Read CLAUDE.md. Appeal the assessment, claim the exemptions.
>
> Build:
> 1. The home's assessed value against its market value (the home value from the demo
>    bank's home or the person's own figure, and stand-in comparable sales), the county's
>    appeal window as a deadline, a drafted appeal with the comparables, and exemptions
>    not yet claimed (homestead, senior, veteran) from a config table per state.
>
> Acceptance criteria:
> - An appeal is suggested only when the gap is over the config threshold; nothing is
>   filed without a tap

### Step 222: Working with an accountant

> Read CLAUDE.md. Hand everything over in one link.
>
> Build:
> 1. A read-only link for the person's accountant: the tax pack, documents, the questions
>    Jane has, and a place for the accountant's answers, which come back into Jane. It
>    expires, can be revoked, and every view is in the audit log. Jane says plainly when a
>    situation is complex enough that people usually use one (facts only).
>
> Acceptance criteria:
> - The link shows only tax data; expiry and revocation are tested; views are logged

### Step 223: Taxes on autopilot, round two

> Read CLAUDE.md. A tax year that runs itself.
>
> Build:
> 1. The year's tax calendar run by Jane: January IP PIN and document chase, quarterly
>    estimates paid through the stand-in within the caps, mid-year withholding check,
>    December's year-end moves in one message, filing day, then the refund tracked. Each
>    item is done by Jane within the caps, or it gets a tap.
> 2. Every tax capability in the registry, with bank questions that score well.
>
> Acceptance criteria:
> - Nothing is paid above the cap without a tap; every month of the calendar has a test

## Phase AN: credit and borrowing, round three (steps 224–230)

Phases Y and AG plan payoffs, refinance, apply, build credit, buy cars and homes, and fix
reports. This round cuts the interest people keep paying without noticing, plays the long
game on student loans and credit scores, tracks money lent between family and friends,
gets the most out of a home's equity, and lays out the facts when debt becomes too much.
Recommendations are demo advice; legal questions go to counsel or nonprofit counselors.
Each step is built into the chat through the step 190 registry, with questions in step 189's
bank.

### Step 224: Less interest on every card

> Read CLAUDE.md. Interest cut without a new card.
>
> Build:
> 1. Paying before the statement date so reported balances stay low, 0% promotions with
>    their end dates as deadlines and the pace that clears them before deferred interest
>    hits, and a request for a lower rate on each card (a call script, or the team through
>    the stand-in), with the yearly saving.
>
> Acceptance criteria:
> - A deferred-interest promo off pace raises a deadline with the monthly amount needed;
>   the statement-date timing has tests

### Step 225: Student loans, the long game

> Read CLAUDE.md. Forgiveness and repayment over the years.
>
> Build:
> 1. Public Service Loan Forgiveness counted month by month with the employer
>    certification reminder, income-driven plan recertification dates as deadlines, the
>    forgiveness date and the tax on forgiven amounts (handed to the taxes side), and when
>    refinancing private loans makes sense; federal loans are never refinanced away from
>    forgiveness without saying what's lost.
>
> Acceptance criteria:
> - Plan rules from config with sources; the forgiveness count has tests

### Step 226: Money between family and friends

> Read CLAUDE.md. Who owes whom, kept kindly.
>
> Build:
> 1. Loans to and from family and friends spotted from payment apps (Venmo, Zelle, Cash App
>    transfers with notes) and confirmed once, with a balance and a gentle reminder the
>    person can send themselves. Co-signed loans are watched for missed payments, and the
>    household's shared debts are split (step 46).
>
> Acceptance criteria:
> - Jane never messages the other person; a transfer is a loan only after the person says so

### Step 227: A credit score for a goal

> Read CLAUDE.md. The score needed, by the date it's needed.
>
> Build:
> 1. A target score and date for a goal (a mortgage next spring, a car in six months), with
>    a monthly plan from step 116's simulator: what to pay down and when, accounts to
>    keep open, inquiries to avoid, and a rapid rescore before a mortgage application.
>
> Acceptance criteria:
> - The plan's months reach the target in the simulator; each month is a checklist with
>   buttons

### Step 228: A home's equity, used well

> Read CLAUDE.md. Equity, PMI and escrow.
>
> Build:
> 1. PMI removal when the loan reaches 80% of the original value (a drafted request letter)
>    and the automatic end at 78%; escrow checked against the real tax and insurance bills,
>    with a refund request when it's overfunded; and HELOC, cash-out refinance and personal
>    loan compared for a project (demo advice).
>
> Acceptance criteria:
> - PMI and escrow rules from config with sources; each comparison shows total cost

### Step 229: When debt is too much: the facts

> Read CLAUDE.md. Every option laid out plainly, without legal advice.
>
> Build:
> 1. When debt payments pass a config share of income: hardship programs per lender, a
>    debt management plan through a nonprofit credit counselor (referral list), and the
>    facts of settlement and bankruptcy (effect on credit, taxes on forgiven debt, how long
>    each lasts), with a pointer to counsel for legal questions.
>
> Acceptance criteria:
> - The guardrail blocks legal advice in these answers (tests); figures come from the
>   person's own debts

### Step 230: Debt on autopilot, round two

> Read CLAUDE.md. One yearly debt review, done for them.
>
> Build:
> 1. Once a year (and after a raise, a new loan or a missed payment): one message with
>    payments timed to statement dates, promos on pace, rate requests made, PMI and escrow
>    checked, score goals on track. Jane does what's within the caps; the rest gets a tap.
> 2. Every debt and credit capability in the registry, with bank questions that score well.
>
> Acceptance criteria:
> - One message with every item's button; nothing above the cap without a tap

## Phase AR: Jane understands you (steps 252–258)

The founder's direction (2026-10-20): most features will never be found by the person, so
Jane has to understand their money better than they do and bring the right suggestion to
them, including ideas they would never think to ask for. Features are only worth building
if Jane can tell who they're for. This phase builds that core; Phase AS connects every
existing feature to it. Phases AO, AP and AQ wait until both are done.

### Step 252: Eight sample people

> Read CLAUDE.md. Prove suggestions on different lives, not one.
>
> Build:
> 1. Eight demo people, each a full demo bank with a year of transactions, loans, policies,
>    investments and documents: a young renter with a first job, a family with kids and a
>    mortgage, a freelancer with uneven income, a high earner with stock pay, a couple
>    near retirement, a retiree, someone in debt trouble, and a small-business owner. Each
>    has a written list of what Jane should suggest and what she must not.
> 2. "Try Jane" lets the visitor pick a life (or picks one), and tests can build any of them.
>
> Acceptance criteria:
> - Each person builds from the same sync path as the demo bank; trial rules (step 138)
>   hold for all of them

### Step 253: The picture of you

> Read CLAUDE.md. One living profile every feature reads.
>
> Build:
> 1. One profile per person built from transactions, accounts, documents and answers:
>    income pattern and employer, household and dependants, home, cars, pets, debts,
>    policies, benefits, goals, habits, risk, life stage and recent events. Every fact has
>    its source and confidence (seen, told, guessed), and sector code reads it in place of
>    its own guesses.
> 2. "What Jane knows about you" page and chat answer, where the person can correct any fact.
>
> Acceptance criteria:
> - Each of the eight people's profiles matches their written description; a correction
>   updates every reader

### Step 254: Every feature says who it's for

> Read CLAUDE.md. The detector contract.
>
> Build:
> 1. Each capability in the step 190 registry declares a detector: given the profile, does it
>    apply, what is it worth in dollars a year (or the risk avoided), how sure Jane is,
>    how urgent, why this person ("you pay $1,240; people like you pay about $600"), and
>    the action with its button.
> 2. A test that fails for any capability without a detector, and a test harness that runs
>    every detector on the eight people against their written lists.
>
> Acceptance criteria:
> 3. Confidence as a percentage on every suggestion (founder, 2026-10-20): "Jane is 85% sure,
>    based on 12 months of charges". It is worked out from the evidence (how much data, how
>    clean the match, facts seen or told or guessed), never made up, and its reason is
>    shown next to it. It means how likely the suggestion is right for this person and
>    worth the stated amount, not a promise about markets or outcomes.
>
> Acceptance criteria:
> - The contract is documented in docs/detectors.md with two worked examples; the harness
>   reports, per person, what fired and what should have
> - Every suggestion carries a percentage and its reason; the same evidence always gives the
>   same percentage (tests)

### Step 255: The nightly scan

> Read CLAUDE.md. Everything checked for everyone, the best shown first.
>
> Build:
> 1. The nightly run (step 142) runs every detector for every person and ranks the results
>    by dollars × confidence × urgency, adjusted by what the person has said yes to (step
>    207). Only the top one to three reach them per day (step 147's budget); the rest wait
>    and are re-ranked tomorrow. Nothing is shown twice after a no.
>
> Acceptance criteria:
> - Ranking has tests; each of the eight people gets their top suggestions from their
>   written list

### Step 256: Claude as strategist

> Read CLAUDE.md. Ideas that come from seeing everything at once.
>
> Build:
> 1. Weekly, Claude reviews the person's whole profile and every sector's results with the
>    registry's tools and proposes combinations no single detector sees ("your March
>    bonus: part to the HSA to cut tax, the rest to the 9% car loan"). Every figure must
>    come from a tool result, every idea must end in registered actions, and the
>    guardrails (and demo_advice in advice mode) check each one before it joins the
>    ranking.
> 2. Without a key, nothing is proposed; costs stay within the daily cap.
>
> Acceptance criteria:
> - An idea with a figure not from a tool is dropped (tests with a fake Claude); ideas are
>   tagged as strategist ideas in the scoreboard
> - A strategist idea's confidence comes from the detectors and tools it rests on (the
>   weakest part), never from Claude's own say-so

### Step 257: The one question worth asking

> Read CLAUDE.md. Fill the gap that unlocks the most money.
>
> Build:
> 1. When a detector could fire but needs a fact the profile doesn't have ("Does your job
>    offer a 401(k)?"), Jane scores each missing fact by the dollars it would unlock and
>    asks the best one, one question at a time, within the asking budget. The answer goes
>    into the profile.
>
> Acceptance criteria:
> - Each of the eight people is asked their highest-value question first; nothing is asked
>   twice

### Step 258: The reach scoreboard

> Read CLAUDE.md. Proof that the features reach people.
>
> Build:
> 1. /admin/reach: for each sample person (and, in totals only, real people), which
>    capabilities fired, dollars shown, yes rate, wrong suggestions, and capabilities that
>    never reach anyone. Confidence is checked for honesty: of the suggestions Jane
>    was 80% sure of, about 80% should prove right (step 207's results). Each detector whose
>    percentages run high or low is listed so it can be corrected. The nightly CI run (step 195) fails on a new wrong suggestion or
>    a person losing a right one.
>
> Acceptance criteria:
> - Every capability reaches at least one sample person or is listed as unreachable with a
>   reason

## Phase AS: every feature finds its person (steps 259–266)

Every lane turns its own features into detectors under step 254's contract and proves them on
the eight people. No new features in this phase.

### Step 259: Insurance, proactive

> Read CLAUDE.md. Detectors for every insurance capability (Phases X, AD, AJ), proven on the
> eight people.

### Step 260: Debt and credit, proactive

> Read CLAUDE.md. Detectors for every debt and credit capability (Phases Y, AG, AN).

### Step 261: Taxes, proactive

> Read CLAUDE.md. Detectors for every tax capability (Phases Z, AF, AM), with deadlines
> driving urgency.

### Step 262: Investing, proactive

> Read CLAUDE.md. Detectors for every investing capability (Phases AA, AE, AL).

### Step 263: Spending, bills and cash, proactive

> Read CLAUDE.md. Detectors for subscriptions, fees, idle cash, bills, budgets, the forecast
> and goals (steps 1–80 and Phases AC and AK).

### Step 264: Household and life, proactive

> Read CLAUDE.md. Detectors for households, life events, documents and deadlines.

### Step 265: Jane leads with suggestions

> Read CLAUDE.md. The chat opens on what matters.
>
> Build:
> 1. The morning message and the chat's opening lead with the scan's top suggestions, each
>    with its "why you", its dollars, its confidence percentage with the reason, and its
>    button; pages become the detail behind a
>    suggestion, not the way in.
>
> Acceptance criteria:
> - Each sample person's first chat shows their top suggestions from the written list

### Step 266: Proof on every person

> Read CLAUDE.md. The scoreboard green.
>
> Build:
> 1. Every capability reaches at least one sample person; no wrong suggestions; each person's
>    written list matched; a QA pass through each person's chat.
>
> Acceptance criteria:
> - /admin/reach shows full reach; the nightly run is green for a week

## Phase AT: taxes, round four (steps 267–273)

Written after Phase AS: every step here ships with its detector (who it's for, dollars, a
confidence percentage from the shared recipe with its reason, urgency, why you, action),
reaches at least one sample person in real data, and adds bank questions. Recommendations are
demo advice; legal questions go to counsel.

### Step 267: Business owners' tax structure

> Read CLAUDE.md. The S-corp question and the business deduction, worked out.
>
> Build:
> 1. For self-employed and small-business people (step 123's signals): the qualified
>    business income deduction estimated, whether an S-corp election would save more than
>    its payroll and filing costs at their profit (config thresholds with sources), a
>    reasonable salary range, and the home office and vehicle deductions from transactions.
>
> Acceptance criteria:
> - The small-business owner and the freelancer get the right answer for their profit; the
>   math has tests

### Step 268: Inherited money and gifts

> Read CLAUDE.md. Inheritances and gifts, taxed right.
>
> Build:
> 1. An inherited IRA's withdrawal deadline (the 10-year rule and its exceptions) spread to
>    keep brackets low, step-up in basis on inherited assets, gifts over the annual
>    exclusion flagged for a gift tax return, and estate tax facts, with a pointer to counsel.
>
> Acceptance criteria:
> - Rules and limits from config by year with sources; the guardrail blocks legal advice

### Step 269: Health coverage and taxes

> Read CLAUDE.md. The tax side of health insurance.
>
> Build:
> 1. Marketplace premium tax credit reconciled against real income (repayment risk caught
>    mid-year), HSA contributions over the limit caught before filing, and the medical
>    deduction checked against the income floor from step 200's spending.
>
> Acceptance criteria:
> - A mid-year income rise raises the repayment warning; limits from config

### Step 270: Disasters and losses

> Read CLAUDE.md. When a disaster hits, the tax relief applied.
>
> Build:
> 1. IRS and state disaster postponements for the person's county (stand-in feed, config
>    dates) moving their deadlines automatically, casualty loss rules, and the claim
>    records kept with the insurance claim (step 107).
>
> Acceptance criteria:
> - A postponement moves every affected deadline (tests); nothing is claimed twice

### Step 271: Taxes on retirement income

> Read CLAUDE.md. Social Security, Medicare surcharges and withdrawal order, taxed well.
>
> Build:
> 1. How much Social Security is taxable at their income, the Medicare surcharge (IRMAA)
>    thresholds two years ahead, and the withdrawal order from step 212 tuned to stay under
>    them, handed to the investing side.
>
> Acceptance criteria:
> - Thresholds by year from config; the couple near retirement and the retiree get their own
>   figures

### Step 272: The return, checked before you file

> Read CLAUDE.md. A second look at a draft return.
>
> Build:
> 1. A draft return (PDF from software or an accountant) read with confirm, line by line
>    against what Jane knows: income missing, deductions or credits left out, figures that
>    don't match the forms, each a card with its dollars, before the person files.
>
> Acceptance criteria:
> - The demo draft has three planted mistakes and Jane finds all three; nothing is filed by
>   Jane

### Step 273: Taxes on autopilot, round three

> Read CLAUDE.md. Every tax detector working as one.
>
> Build:
> 1. The year's tax calendar (step 223) driven by every tax detector, ranked with the rest of
>    the scan, one message per month at most unless something is urgent, and the reach
>    scoreboard showing every tax capability reaching the right sample people.
>
> Acceptance criteria:
> - Every tax capability has a detector or a reasoned exemption; the nightly run is green

## Phase AU: perfect coverage (steps 274–280)

Founder-approved 2026-10-21. Jane works out what cover each person needs from their own data,
shows the gap against what they have, and offers several options to pick from, each with its
price, cover and a one-line reason, her pick marked with a confidence percentage. Picking one
queues the action for the concierge team at once. Every threshold lives in
`src/config/insurance.ts`; nothing is inline. Recommendations are demo advice (the label, the
`demo_advice` guardrail profile); `REAL_ACCOUNT_ADVICE` stays false, so real accounts see
the need and the gap as facts, never an option to buy. No Anthropic spend in tests. Every step
ships with its detector, its chat answers and its bank questions.

### Step 274: What cover you need

> Read CLAUDE.md. The need, worked out from the person's own data, and the gap.
>
> Build:
> 1. Pure need calculators (`src/lib/insurance/need/`), each returning the need, the cover now
>    in place, the gap and the line-by-line working: term life (income replaced for a number
>    of years, plus debts, plus each child's education, less savings and cover through work),
>    disability (about 60% of income), umbrella (net worth over the liability limits on car
>    and home), deductibles (sized to the cash cushion, step 253's profile), and the liability
>    levels for renters, home and auto.
> 2. Every rate, multiple and threshold in config with where it comes from; the inputs come
>    from the person's profile (step 253) and their policies, never guessed when told.
>
> Acceptance criteria:
> - Each calculator has tests at its edges (no income, no dependants, no policies); the same
>   inputs always give the same need

### Step 275: Options to pick from

> Read CLAUDE.md. Three or four real options for each gap.
>
> Build:
> 1. For each gap, and for each policy worth a second look, three to four options from the
>    quote stand-in: like for like, cheaper with a stated trade-off, and better cover for a
>    stated price. Each has the price a year, the cover, the carrier's rating and one line on
>    why this one ("Cheapest that keeps your $100k/$300k cover").
> 2. Jane's pick is marked with a confidence percentage and its reason, built from the shared
>    recipe: a same-cover quote beats a cheaper one, a better-rated carrier breaks a tie.
>
> Acceptance criteria:
> - Options are always like-for-like unless the trade-off is said; the pick is the same for the
>   same evidence

### Step 276: The pick-one card

> Read CLAUDE.md. Options as a card in the chat, and one tap to choose.
>
> Build:
> 1. Option data in the shape the chat's "pick one of N" card takes (agreed with the chat lane):
>    short cards, a "More details" for the working and the comparison, her pick first.
> 2. Choosing an option queues the action for the concierge team instantly (bind, endorse or
>    quote request through the stand-in), with the choice recorded; nothing changes cover
>    without that tap.
>
> Acceptance criteria:
> - One tap queues it; asking again never queues twice; a real account sees the need and the
>   gap but no option card

### Step 277: A detector for every gap

> Read CLAUDE.md. Perfect coverage, brought unasked.
>
> Build:
> 1. A detector per gap (life, disability, umbrella, deductible, liability levels), each with
>    its value, confidence, urgency, why you and the action opening its option card, reaching
>    the right sample people and none on a must-not list.
>
> Acceptance criteria:
> - The harness shows each gap reaching the right people; the reach baseline is updated on
>   purpose

### Step 278: Ask it in the chat

> Read CLAUDE.md. "How much life insurance do I need?", answered from the same numbers.
>
> Build:
> 1. A Claude tool and rules answers for each need question, three sentences or fewer with
>    the person's figures and the gap, and the option card when they ask what to get.
> 2. Bank questions for each, with follow-ups ("what if I have another child", "and if I
>    raise the deductible").
>
> Acceptance criteria:
> - The chat and the page give the same need for the same person (one source of truth); the
>   questions score 100

### Step 279: Your perfect coverage page

> Read CLAUDE.md. The whole picture on one page.
>
> Build:
> 1. A section on `/insurance` showing each need, what they have, the gap, and the options
>    behind "See options", with the working under "More details".
>
> Acceptance criteria:
> - The page and the chat agree; an e2e test walks from a gap to a picked option

### Step 280: Kept perfect

> Read CLAUDE.md. The need changes when life does.
>
> Build:
> 1. The needs are re-worked after a life event (step 100), a raise, a new child or a home
>    bought, and the yearly review (step 202) shows the gaps that opened, with the option
>    card; a pick is always a tap.
>
> Acceptance criteria:
> - A new child opens the life-cover gap the same day; nothing is bought without a tap

## Phase AW: automated investing, Stage A: practice money only (steps 288–297)

Founder-approved 2026-10-21, ahead of the depth bar. **Everything in Stage A runs on sample data
and a paper (practice) portfolio. No real money moves, no real account is traded, and
`REAL_ACCOUNT_ADVICE` stays false:** all of it is demo advice, labelled "Demo advice: sample data,
not financial advice", and any text Claude writes about it passes the `demo_advice` guardrail
(unsupported figures, promised outcomes and legal advice stay blocked). Real accounts get facts
only. No new Anthropic spend in tests.

Data sources, in one place (`src/lib/market/`): a `MarketData` interface (prices, a news feed,
filings) with three implementations behind it. **Sample** (now): synthetic and recorded daily
prices and headlines for the model portfolios' ETFs, deterministic by date, so every test and the
Try Jane people have the same market. **Alpaca** (stub only; needs an account the founder creates,
Jane never creates one): market data and news endpoints, behind env keys that are unset. **SEC
EDGAR** (stub, no key needed, descriptive User-Agent): filings for news-driven ideas. Nothing calls
a live service until a key is set; the stubs have contract tests against recorded responses.

**Stage B (not built here): the partner swap.** The paper ledger's `Broker` interface
(`placeOrder`, `positions`, `cancel`) gets a licensed broker-dealer or RIA partner behind it, the
real-account advice rule (`REAL_ACCOUNT_ADVICE`) is revisited with counsel, and Alpaca (or the
partner's own feed) replaces Sample. Stage A is written so Stage B changes configuration and one
adapter, not the product: the model portfolios, the risk questionnaire, the scan, the log and the
cards stay as built.

### Step 288: Five risk levels

> Read CLAUDE.md. A short questionnaire and five levels.
>
> Build:
> 1. Four questions (time horizon, reaction to a 20% drop, income stability, goals) map to one of
>    five levels: Very low, Low, Medium, High, Very high. The lower of capacity (horizon,
>    stability) and willingness (reaction) wins, with the reason in a sentence. Replaces the
>    older five-level labels where they differ; the existing investor profile answers carry over.
> 2. Each level has a model portfolio of diversified index ETFs (US stocks, international stocks,
>    bonds, cash and short-term bills) with stock/bond/cash targets in `src/config/portfolios.ts`
>    (sources shown; FOR REVIEW).
>
> Acceptance criteria:
> - The same answers always give the same level; the targets of every level sum to 100%; a
>   higher level never has fewer stocks than a lower one (tests)

### Step 289: The market data interface and the sample market

> Read CLAUDE.md. Prices and headlines behind one interface.
>
> Build:
> 1. `MarketData` (prices, history, news, filings) with the Sample implementation: deterministic
>    synthetic daily prices and recorded headlines for the model portfolios' ETFs and a short list
>    of large companies, plus planted dips, rallies and news events so every scan has something to
>    find.
> 2. Stubs for Alpaca market data and news and SEC EDGAR, unused without keys, with contract tests
>    on recorded responses. No account is created; no key is stored in code.
>
> Acceptance criteria:
> - The same date always returns the same sample prices; swapping the implementation changes no
>   other file (tests)

### Step 290: The practice portfolio and the paper ledger

> Read CLAUDE.md. Practice money in the database.
>
> Build:
> 1. A paper ledger (`PracticePortfolio`, `PracticeTrade`, `PracticePosition`): cash, positions
>    by lot, each trade with its time, side, size, price from the market data, the reason in a
>    sentence and the rule that allowed it. Starting practice cash is a stated sample amount;
>    never linked to a real account.
> 2. A `Broker` interface with the paper implementation only.
>
> Acceptance criteria:
> - The ledger balances to the cent after any run of trades; a practice trade can never touch a
>   real account or the real brokerage stand-in (tests)

### Step 291: Autopilot for the practice portfolio

> Read CLAUDE.md. Pick a style, then Jane runs it.
>
> Build:
> 1. Once the person picks a level (or accepts the questionnaire's), Jane buys the model
>    portfolio, rebalances when a class drifts past the band, and adds a monthly amount on the
>    day they choose, in the practice ledger.
> 2. Hard limits in config: no leverage, no options, no shorting, a per-position cap, a
>    per-trade cap, a daily trade count. A **pause switch**. Every action writes to the audit log
>    and the trade log with its reason.
>
> Acceptance criteria:
> - No order breaks a limit; paused means no trades; every trade has a reason and an audit row
>   (tests)

### Step 292: The daily scan

> Read CLAUDE.md. Four things worth a look.
>
> Build:
> 1. A daily Vercel Cron scan of each practice portfolio over the market data, flagging
>    **drift-rebalance**, **dip-buy-within-plan** (a drop in a holding already in the plan, bought
>    only with cash the plan allows), **tax-loss-harvest** (step 124's lots; a swap that keeps the
>    mix and avoids a wash sale) and, **for High and Very high levels only**, **news-driven
>    ideas**. Each has a size cap, a per-position cap and a monthly count cap.
> 2. Opportunities are small and capped positions only (a share of the portfolio set in config),
>    never at Very low, Low or Medium.
>
> Acceptance criteria:
> - Each flag fires on the sample market's planted event and not otherwise; opportunities never
>   appear below High; caps hold (tests)

### Step 293: News, summarised cheaply

> Read CLAUDE.md. A few batched calls a day.
>
> Build:
> 1. Headlines for the watchlist summarised by Claude Haiku in a few batched calls a day
>    (`ANTHROPIC_MODEL_NEWS`), behind a monthly cents cap in config (default 100). **Off unless the
>    env key is set**; with no key (and in every test) a rules summary from the headline text is
>    used. Summaries pass the `demo_advice` guardrail and never predict a price.
> 2. EDGAR filings (8-K, 10-Q) shown as facts with a link.
>
> Acceptance criteria:
> - No call is made without the key or past the cap; a test proves zero Anthropic calls in the
>   suite

### Step 294: The trade log and the pause switch

> Read CLAUDE.md. See and stop everything.
>
> Build:
> 1. A page and a chat answer: every practice trade with its reason, the rule that allowed it and
>    the running result; a pause switch for the whole portfolio and for opportunities alone;
>    "undo the last trade" in the ledger (practice only).
>
> Acceptance criteria:
> - Pausing takes effect before the next scan; the log matches the ledger (tests)

### Step 295: Backtests by level

> Read CLAUDE.md. How each level would have behaved.
>
> Build:
> 1. For each of the five levels, a backtest over the sample historical prices (several years,
>    including a planted crash and recovery): the value path, the worst drop, the best and worst
>    year, shown as a simple chart and a few figures with the assumptions beside them (fees,
>    rebalancing, no taxes in the base case). Always labelled as a replay of sample history, not a
>    forecast.
>
> Acceptance criteria:
> - Higher levels have larger worst drops than lower ones in the sample; the figures match a
>   hand-worked case (tests)

### Step 296: Cards in the chat

> Read CLAUDE.md. Short, with the reasoning one tap away.
>
> Build:
> 1. Opportunities and trades appear as the chat lane's floating cards, each short (what, how
>    much, why in a sentence), with **More details** (the rule, the numbers, the caps) and the
>    confidence percentage with its reason. A card's button only ever opens the details or the
>    pause switch; nothing real is bought.
> 2. A detector (step 254's contract) for "set up your practice portfolio" so it reaches the
>    right sample people.
>
> Acceptance criteria:
> - Cards follow the chat lane's card shape; every card has a percentage and a reason; no card
>   offers a real trade (tests)

### Step 297: Proof

> Read CLAUDE.md. Stage A, checked end to end.
>
> Build:
> 1. A graded set of chat questions about the practice portfolio ("what did you buy this week and
>    why", "pause it", "what's my risk level", "how would a High portfolio have done in 2022"), a
>    walk through the sample people, and a note for Stage B listing exactly what the partner swap
>    needs.
>
> Acceptance criteria:
> - The questions pass in the bank; no step touches real money or a real account; the Stage B
>   note is in the PR

## Phase AV: the perfect fit for borrowing (steps 281–284)

Founder-approved 2026-10-21, a depth change to borrowing rather than a new feature round: for
any borrowing need (a car, a home, a refinance, consolidating debt, a personal loan) Jane
picks the best product for this person from their credit, debt-to-income, cash and goals, and
shows two to four options to choose from. It is the one place the answer comes from: the
debt decisions (step 260 on, `debt_decision`), the refinance and consolidation answers and the
suggestions all read it. Recommendations are demo advice (labelled "Demo advice: sample data,
not financial advice"); a real account gets the options and the math, never a pick. Offers come
from the lender stand-in (`src/lib/lenders`); nothing is applied for without a tap, and tests
spend nothing on the Anthropic API.

### Step 281: The fit engine

> Read CLAUDE.md. One engine that scores borrowing options for a person and a need.
>
> Build:
> 1. A pure planner (`src/planning/fit.ts`, every threshold in `src/config/fit.ts` with its
>    source, nothing inline) that takes a need (car, home, refinance, consolidation, personal),
>    the person's credit band and score, income, debt payments, cash, goals and the offers from
>    the lender stand-in, and returns each option with: eligible or not and why (credit floor,
>    debt-to-income ceiling, income), the total cost over the whole term with fees (not just
>    the rate), the monthly payment as a share of take-home against a comfortable share, the
>    fees and when they pay back, and a score that ranks them.
> 2. Two to four options, never one: the best by total cost that is comfortable, the lowest
>    payment, the shortest term or fastest payoff, and one stretch or alternative where it
>    differs. Jane's pick, a confidence percentage from the shared recipe (the weakest of its
>    evidence) and its reason.
>
> Acceptance criteria:
> - Eligibility, total cost, payment share and the pick each have tests on the eight sample
>   people; the debt-trouble person is never steered to a bigger payment; no figure or
>   threshold is inline

### Step 282: Option cards in the chat

> Read CLAUDE.md. The options shown as a pick-one card, short first.
>
> Build:
> 1. The fit options as the shared option card every lane uses (the type from the insurance
>    lane's `OptionCard`, kind "loan", shown by the chat's floating "pick one of N" card):
>    each option one short headline (about eight words, one number: "Credit union 6.9%,
>    save $1,840"), the monthly payment, facts (rate, term, total interest, fees), why this
>    one, and "More details" with the maths. Jane's pick and its confidence percentage and
>    reason are set only in demo advice mode, with the demo advice label. Choosing one queues
>    the concierge action through the existing finding, decision and action path in the
>    background: it never submits an application or moves money, and needs no new table.
>
> Acceptance criteria:
> - The card shows two to four options, with the pick marked only in advice mode; choosing
>   never applies for anything (tests)

### Step 283: One source of truth

> Read CLAUDE.md. The decisions, the offers and the suggestions agree.
>
> Build:
> 1. The `debt_decision` answers (consolidate, personal loan, pay off versus invest), the
>    refinance and balance transfer answers and the car and home offers read the fit engine's
>    options, so the chat, the pages and Claude's tools never disagree on a rate, a payment or
>    the pick.
> 2. A detector for refinance and consolidation opportunities (who it is for, dollars saved
>    over the term, confidence from the shared recipe with its reason, urgency, why you, and
>    the action that opens the options), reaching at least one sample person in real data.
>
> Acceptance criteria:
> - A test asserts the chat, the tool and the page give the same pick for the same person;
>   the detector fires for the people with a costly card, auto or student loan and for no
>   one on a must-not list

### Step 284: Bank questions and a skeptical review

> Read CLAUDE.md. Prove the picks are right for each life.
>
> Build:
> 1. Must-pass bank questions for each need and for follow-ups ("what about a shorter
>    term?", "why that one?"), with `avoid` for the wrong answers seen.
> 2. Review each sample person's options as a skeptical customer (dollars believable and
>    counted once, the pick sensible for their life, confidence varies with reasons in plain
>    words) and fix what is off, with tests that pin the wording and ranges.
>
> Acceptance criteria:
> - The review is written to `docs/detectors/review-fit.md` with a verdict per person

## Depth first: the bar before new features (founder, 2026-10-21)

Jane already has the breadth. Until the chat and suggestions are right, every lane works on
depth, and the deferred rounds below (and Phase AT) stay paused. They resume only when all
of these have held for three days in a row:

1. The nightly graded run (step 195): at least 95% understood, 100% right figures, at least
   90% of follow-ups and two-part questions answered.
2. QA's live chat sweep: 40 real questions (decisions, follow-ups, typos, two-in-one) for
   each of the eight sample people, with no wrong or empty answers and no lost topic.
3. The reach scoreboard (step 258): each sample person's top three suggestions match their
   written list, with no must-not suggestion.
4. Speed: a tap answers within 1 second, and Try Jane reaches a usable chat within 10
   seconds.

When they resume, every new capability ships with its detector, its chat answers and its
bank questions from day one.

## Deferred rounds, resumed after Phase AS (2026-10-21)

The rounds below were written before the founder's direction of 2026-10-20 and wait until
every existing feature finds its person. Each new feature in them must ship with its
detector.

### Deferred Phase AO: investing, round four (steps 231–237)

Phases AA, AE and AL cover every account and goal. This round makes the whole portfolio
work as one: the right investments in the right accounts across the household, the
workplace plan's own fund menu used well, honest performance, short-term money placed
safely, sudden money handled with a plan, investing that matches the person's values, and
the accounts set up so the family is looked after. Recommendations are demo advice; legal
questions go to counsel. Each step is built into the chat through the step 190 registry,
with questions in step 189's bank.

#### Step 231: The right investment in the right account

> Read CLAUDE.md. Asset location across every account and both partners.
>
> Build:
> 1. One allocation across all of the household's accounts (shared only as step 25
>    allows), with tax-inefficient holdings placed in tax-advantaged accounts and
>    tax-efficient ones in taxable accounts, the yearly tax saved (step 120's rates), and the
>    moves to get there through the stand-in brokerage without selling at a gain where it
>    can be avoided.
>
> Acceptance criteria:
> - The overall mix stays the same before and after; no sale at a gain without showing its
>   tax

#### Step 232: The workplace plan's menu, used well

> Read CLAUDE.md. The cheapest good mix from the funds the plan offers.
>
> Build:
> 1. The 401(k) or 403(b) fund list read from a statement or the plan's fee disclosure
>    (step 151's document reading pattern, confirm before saving): each fund's cost and
>    asset class, the cheapest mix that matches the person's target, and a target-date
>    fund's fee checked against building it by hand. Changes go to the payroll stand-in
>    or the team.
>
> Acceptance criteria:
> - Only funds on the plan's menu are suggested; the fee saving is in dollars a year

#### Step 233: Honest performance

> Read CLAUDE.md. How the money really did.
>
> Build:
> 1. Returns weighted by when money went in and out, after fees and taxes, against a simple
>    benchmark mix with the same risk, for one, three and five years, with why they
>    differ (fees, cash drag, timing). No forecasts, only what happened.
>
> Acceptance criteria:
> - The money-weighted return math has tests; benchmarks from config with sources

#### Step 234: Short-term money, placed safely

> Read CLAUDE.md. Money needed within three years.
>
> Build:
> 1. For goals under three years and the emergency fund above its floor: Treasury bills, a
>    CD ladder, I bonds and high-yield savings compared after tax (Treasury interest is
>    free of state tax, step 165), with a ladder that matures when the money is needed and
>    rolls itself over through the stand-in.
>
> Acceptance criteria:
> - Nothing locks money past its goal date; after-tax yields use the person's own state

#### Step 235: Sudden money

> Read CLAUDE.md. A bonus, an inheritance or a home sale, with a plan.
>
> Build:
> 1. A large deposit that isn't pay gets one question ("Is this a bonus, an inheritance, a
>    sale?"). Then comes a staged plan across every sector: taxes set aside, high-interest
>    debt, the emergency fund, the match and limits, goals, then investing, using step
>    203's scenarios, each part a tap.
>
> Acceptance criteria:
> - The tax set-aside comes first and is figured by kind; nothing moves without a tap below
>   "handle everything"

#### Step 236: Investing by your values

> Read CLAUDE.md. What the money is invested in, matching what the person cares about.
>
> Build:
> 1. Exclusions and preferences (fossil fuels, weapons, tobacco, or favouring certain
>    themes) applied to fund choices and rebalancing through a tagged stand-in fund
>    catalog, with the cost and the difference in diversification shown honestly.
>
> Acceptance criteria:
> - Preferences never break the person's risk target; the fee difference is in dollars

#### Step 237: The family looked after

> Read CLAUDE.md. Beneficiaries and access, set up before they're needed.
>
> Build:
> 1. Every account's beneficiaries checked (missing, or out of date after a marriage, a
>    divorce or a birth, from step 100's life events), transfer-on-death set-ups where the
>    account allows, and a "what my family would need" file of accounts and contacts the
>    person can share. Wills and trusts get the facts and a pointer to counsel, never
>    legal advice.
>
> Acceptance criteria:
> - The guardrail blocks legal advice here (tests); the family file shares only what the
>   person picks

### Deferred Phase AP: Jane runs the money, round three (steps 238–244)

Phases AC and AK have Jane plan, route, watch and learn. This round makes her a controller
people can trust with everything: books that always balance, every figure explained and
correctable, a steady paycheck from uneven income, goals that trade off openly, money run
well for couples, price rises seen before they land, and a monthly close that runs itself.
Each step is built into the chat through the step 190 registry, with questions in step 189's
bank.

#### Step 238: Books that balance

> Read CLAUDE.md. Data Jane can stand behind.
>
> Build:
> 1. Every day: balances checked against the sum of transactions, duplicate accounts and
>    duplicate transactions across links found and merged, gaps where a bank stopped
>    sending caught, transfers between the person's own accounts matched in pairs, and a
>    broken link turned into one reconnect message (step 7's Link update mode). Figures
>    that rely on bad data are marked until it's fixed.
>
> Acceptance criteria:
> - The demo bank has one of each problem and each is caught; nothing is merged without a
>   test proving both sides match

#### Step 239: Every figure explained, and correctable

> Read CLAUDE.md. "How did you get that?" answered for any number.
>
> Build:
> 1. Every figure Jane shows (in the chat, cards, pages) can open its working: the
>    transactions, the rule or rate from config, and the date. "That's wrong" on any figure
>    lets the person fix the input (a category, an income, a bill), and the correction
>    sticks and flows to every sector that used it.
>
> Acceptance criteria:
> - Each sector's headline figure has its working; a correction changes every page that
>   used it (tests)

#### Step 240: A steady paycheck from uneven income

> Read CLAUDE.md. Freelancers and commission earners paid like an employee.
>
> Build:
> 1. For uneven income (step 123's self-employed signals or the person saying so): a buffer
>    account target, a steady monthly "paycheck" to checking through step 144's stand-in,
>    taxes set aside from each deposit (step 120), and the plan adjusted when the buffer runs
>    high or low.
>
> Acceptance criteria:
> - The paycheck never drains the buffer below its floor; tests over a year of uneven
>   deposits

#### Step 241: Goals that trade off openly

> Read CLAUDE.md. When everything can't happen, choosing with the facts.
>
> Build:
> 1. When goals compete for the same money, one view shows each goal's date under each
>    choice ("the trip in June pushes the house fund back four months"), Jane's suggested
>    order with the reason, and the person's pick re-plans every sector.
>
> Acceptance criteria:
> - Each choice's dates come from the year plan (step 205); nothing re-plans without a
>   tap

#### Step 242: Money for two

> Read CLAUDE.md. Couples run their money together and still keep their own.
>
> Build:
> 1. For a household (step 25): joint goals, bills split fairly by income or evenly as they
>    choose, each person's own money kept private, both partners' taps for big moves over
>    a set amount, and a short monthly "money date" message for both.
>
> Acceptance criteria:
> - Private accounts never appear to the partner (tests); big moves need both taps

#### Step 243: Price rises seen before they land

> Read CLAUDE.md. Promo ends and renewals caught early.
>
> Build:
> 1. Introductory rates ending (internet, phone, streaming bundles, insurance, card
>    promos), annual renewals and price-change notices from documents become deadlines a
>    month ahead, each with the cheaper choice or the call script, before the higher price
>    is charged.
>
> Acceptance criteria:
> - The demo bank has a promo ending and an annual renewal; both raise a deadline at least
>   30 days ahead

#### Step 244: The monthly close

> Read CLAUDE.md. Like a company's books, closed every month by Jane.
>
> Build:
> 1. On the first of the month, Jane closes the month before: books balanced (step 238),
>    uncertain categories confirmed in one message, net worth snapshot, plan against
>    actual (step 205), what worked (step 207), and the report (step 148). The person only
>    taps where Jane wasn't sure.
>
> Acceptance criteria:
> - A month closes with no taps when nothing is uncertain; a closed month's figures don't
>   change unless a correction is made

### Deferred Phase AQ: credit and borrowing, round four (steps 245–251)

Phases Y, AG and AN plan, refinance, buy and repair credit. This round covers the loans
people already have and rarely revisit, the costly short-term borrowing that traps them,
renters, families helping each other with credit, and a standing answer to "what could I
borrow, and at what rate?". Recommendations are demo advice; legal questions go to counsel.
Each step is built into the chat through the step 190 registry, with questions in step 189's
bank.

#### Step 245: The car loan you already have

> Read CLAUDE.md. Lower payments and refunds on an existing car loan.
>
> Build:
> 1. Auto refinancing checked when rates fall or the score rises (lender stand-in, total
>    cost compared), and dealer add-ons found in the loan (GAP, extended warranty, service
>    contracts) with the refund each would give if cancelled, plus a drafted cancellation
>    for the team or the person.
>
> Acceptance criteria:
> - Refinancing compares total cost, not the payment; refund math has tests per add-on kind

#### Step 246: Recast, refinance or pay extra

> Read CLAUDE.md. The best use of extra money on a mortgage.
>
> Build:
> 1. For a lump sum or extra monthly money: a recast (lower payment, same rate), a
>    refinance (step 111) and extra principal compared over the loan's life, against
>    investing it instead (step 214's comparison), each with its fees and the date it pays
>    back.
>
> Acceptance criteria:
> - Each option's total interest and break-even date has tests; fees from config

#### Step 247: Out of costly short-term borrowing

> Read CLAUDE.md. Payday loans, cash advances and overdrafts replaced.
>
> Build:
> 1. Payday loans, card cash advances, repeated overdrafts and high-fee pay advance apps
>    spotted in transactions, with the yearly cost in dollars. Then the cheaper way out:
>    a credit union small-dollar loan, an employer pay advance, a 0% card, or a buffer built
>    from the forecast, and a plan to stop the cycle.
>
> Acceptance criteria:
> - Each kind is spotted in the demo bank; the cost shows as an annual rate and in dollars

#### Step 248: Renting, counted

> Read CLAUDE.md. Rent that builds credit, and deposits that come back.
>
> Build:
> 1. Rent payments reported to the credit bureaus through a stand-in reporting partner (the
>    person opts in), a rent increase checked against stand-in local rents, and the
>    security deposit tracked to its return deadline after a move (state rules from config,
>    facts only).
>
> Acceptance criteria:
> - Reporting needs the person's opt-in; deposit deadlines from config with sources

#### Step 249: Helping family with credit

> Read CLAUDE.md. Authorized users, first cards and co-signing, with the risks shown.
>
> Build:
> 1. Adding a teen or partner as an authorized user (the score effect for both), a first
>    card for a student, and co-signing (what happens to the person's own credit and debt
>    load if the other misses), with step 226's family loans for money lent instead.
>
> Acceptance criteria:
> - Co-signed debt counts in the person's own debt-to-income (tests)

#### Step 250: What you could borrow

> Read CLAUDE.md. A standing answer to "what could I get, and at what rate?".
>
> Build:
> 1. Kept current from the score (step 116), income and debts: the likely rate and amount for
>    a mortgage, car loan, personal loan and card, with soft-pull prequalification through
>    the lender stand-in, and what would improve each.
>
> Acceptance criteria:
> - Only soft pulls run without a tap; every figure says when it was last checked

#### Step 251: Credit on autopilot, round three

> Read CLAUDE.md. Borrowing kept cheap by itself.
>
> Build:
> 1. Every month Jane checks for a cheaper rate on each loan, add-ons worth cancelling,
>    costly borrowing creeping back, and the rent and deposit deadlines, then acts within
>    the caps and asks for the rest in one message.
> 2. Every credit capability in the registry, with bank questions that score well.
>
> Acceptance criteria:
> - Nothing that runs a hard pull or opens an account happens without a tap

### Later, when the founder is ready

These need an outside account, a partner or a decision: Plaid Production (real banks) and
Plaid Investments and Liabilities, counsel's review (privacy policy, terms, the education
text, advice for real accounts), licensed partners to take the stand-ins live (a
registered investment adviser and brokerage, an insurance agency, a loan marketplace, a
credit bureau partner, tax filing), a native iPhone app (an Apple developer account), and
Vercel Pro if 100 deploys a day is too few, and a transcription service for speaking to
Jane in browsers without speech recognition (step 186).

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

## Chat architecture: Claude answers, Jane is the data (founder, 2026-10-21)

> Jane is essentially a database of all the user's information. Claude runs the chat, pulling
> from that database to answer. There should never be a prewritten answer. If the user asks
> anything, it should always be Claude's agent answering, using data from Jane. There should
> never be some weird incident like a user saying something and all the chat does is pull up a
> button. Since everything is demo, financial advice is fine.

This replaces "rules first" (steps 191 and 193). It is the chat's architecture:

1. **Every typed message goes to Claude** (`chatModel`, `src/lib/jane-agent/claude.ts`), with no
   rules or matcher answer in front of it: greetings, commands ("cancel Netflix", "approve all",
   "undo"), short replies ("yes", "why?", "ok and?", "what do you mean") and decisions ("should I
   buy bitcoin") alike. The decision paraphrase matcher survives only as the `decision` tool's
   input reading and as the backup. Rules answer only structured events: button and card taps
   (Yes, No, Remind, Undo, Why?), which are not free text, and the answer typed to a guided flow's
   question. With no `ANTHROPIC_API_KEY` (dev, tests) the rules answer typed text, as the backup.
2. **Jane is tools plus context.** The step 190 registry's tools stay (`CHAT_TOOLS`, ~125, a
   question is sent the general ones and its sectors', `tool-select.ts`). The stored primer
   (`primer-store.ts`, refreshed after each sync and scan) carries the numbers, the top three
   things that matter with their confidence (`what_matters_most`) and the open findings summary;
   the finding just discussed is looked up up front; the last topic and the recent turns come with
   the question. Jane computes; Claude never does its own sums (it may only use dollar amounts
   from the numbers and tool results).
3. **Demo advice.** In advice mode (`adviceMode`: every account is the demo bank) Claude gives
   real recommendations on investing, taxes, insurance, loans and crypto, checked with the
   `demo_advice` guardrail profile, and every answer carries "Demo advice: sample data, not
   financial advice". `REAL_ACCOUNT_ADVICE` stays false: real accounts keep the no-advice profile.
4. **A button or a card only ever follows a written answer.** Claude writes the answer first and
   attaches actions through `propose_action` (and a picture through `show_block`) at the end of the
   same turn; its sentences about its own button are stripped, and an answer that is only that is not
   an answer (the backup answers). The checks assert a written answer of at least a sentence for every
   question in the bank (`written` in `checks/grade.ts`), and a test sends the bank's typed questions,
   QA's casual phrasings, the founder's transcript and the commands through the chat asserting none
   reaches a rules answer.
5. **Failure.** A 429, 5xx or overloaded response is tried once more; only those pause Claude (30
   seconds). If Claude still fails, runs out of time, is blocked by the guardrails or the month's guard
   is spent, the person gets a short written answer from the same data (the rules' answer for the
   question, or where they stand), never "unavailable" and never a retraction: text already shown
   stays as the answer.
6. **Speed.** The system prompt and tool definitions are cached, tools are called in parallel in one
   round, the last round answers with no tools, and the answer streams. Targets: first words under 2
   seconds, the full answer under 6. `chat_timing` logs the primer, each round (stop, tools, text,
   milliseconds), the tool times, the tokens, `otherMs` and the cost of every answer.
7. **Cost.** A sample (Try Jane) person gets 25 answers in all (`claudeTrial`, then a friendly
   written message); all of Claude's chat answers together are guarded at `CHAT_MONTHLY_CAP_CENTS`
   (default $8, under the account's $10 limit; `chatmonth:total` in `rate_limits`, kept past the
   daily cleanup); a daily cap per person stays. Past the month's guard Claude is not asked and the
   backup answers.
8. **Measured.** The graded nightly (Claude Haiku as the judge, `docs/chat-quality.md`) asks the bank
   through the real Claude path, including the casual phrasings and follow-ups, and records understood,
   figures right, follow-ups, first-words and full-answer times against the depth bar.


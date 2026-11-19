# Connectors

Jane's plan is to run a person's money for them: read every account, find the best plan in each
area, fill in the steps, and carry them out through partners (paying bills, moving money between
their own accounts, cancelling, switching, getting quotes) once the person taps yes. Connectors are
those partners. Today's beta is read-only, so everything here is **off in production** and no real
connector exists yet: what's built is the shared plumbing every connector plugs into, and sandbox
adapters that simulate partners for sample data.

## The locks

A real connector acts only when all of these hold. Each is tested.

| Lock | Where | Off means |
| --- | --- | --- |
| `CONNECTORS=1` | env | Every connector route answers 404 and the pipeline refuses everything, sandbox included |
| `REAL_CONNECTORS[id]` | `src/config/connectors.ts`, code only | That real connector is refused (`switched_off`) |
| `REAL_MONEY_MOVEMENT` | `src/config/money-movement.ts`, code only | A real connector that moves money is refused |
| `HUMAN_REVIEW_READY` | `src/config/connectors.ts`, code only | A connector marked `recommends` (a personalized investment or tax recommendation) is refused for a real person (`needs_review`), at plan, yes and run, until a qualified reviewer approves each one (Anthropic's Usage Policy from 2026-11-12). Sample data isn't held back |
| `KILL_CONNECTORS`, `CONNECTORS_KILLED=id,id` | env or the ops store (`docs/incident.md`) | Stops them again in seconds |
| Who the person is | `whyUnavailable` in `src/lib/connectors/registry.ts` | Sandbox adapters are for sample data only; real connectors for real data only; trial people never reach a real one |

## Pieces

- **`src/lib/connectors/types.ts`**: the `Connector` type: id, category, capabilities (`read`,
  `prefill`, `act`), the consent scopes it needs, `sandbox`, `movesMoney`, and its methods.
- **`src/lib/connectors/registry.ts`**: the registered connectors, each checked against its own
  definition, and `whyUnavailable`, which says why one can't be used for a person now.
- **`src/lib/connectors/gate.ts`**: a connector's `act` and `cancel` work only inside a grant naming
  that connector, that action and that person, and only the pipeline hands one out. Ported from the
  controller drafts' permission gate (#1190).
- **`src/lib/connectors/consent.ts`**: a person's consent to each connector, by scope
  (`CONSENT_SCOPES` in `src/config/connectors.ts`, with the words the person sees). A new grant is
  a new row and the old one is stamped revoked, so history stays. Revoking deletes the credential
  too. `consentCovers` is what the pipeline checks before every step. `/settings/connections` shows
  what's allowed, since when, a Revoke button, and the history; a 404 unless `CONNECTORS=1`.
- **`src/lib/connectors/vault.ts`**: each person's credential per connector, AES-256-GCM through
  `src/lib/crypto.ts`, rotated by `src/lib/key-rotation.ts` like Plaid's and Robinhood's tokens.
  `withCredential` opens it for the length of a callback; nothing returns the value, and errors
  name the connector only. An expired or undecryptable one is `NoCredential`.
- **`src/lib/oauth-pkce.ts`**: the PKCE and state helpers Robinhood's sign-in used, shared so a
  connector's OAuth sign-in doesn't copy them.

## Connecting one: the one flow every connector uses

`src/lib/connectors/connect.ts` (section C1, 11-19). No connector builds its own.

1. **The tap, in the card that needs it.** `<ConnectTap userId connectorIds={[real, sandboxTwin]} from
   label />` (`src/components/connect-tap.tsx`) shows one optional link, only when connectors are on, one
   of those connectors is usable for this person (`whyUnavailable`), it isn't connected, and they haven't
   said "Not now" (kept as a `jane_preferences` row of kind `system`). The card must still be useful
   without it. Never in sign-up or onboarding (founder rule: one step plus one bank link;
   `src/app/onboarding-no-connectors.test.ts`). First use: the investing card "You put $X into
   investing", offering SnapTrade read only.
2. **The consent screen**, `/settings/connections/<id>`: what Jane gets (the scopes' words), from whom
   (`Connector.from`, else its name), whether the partner has a step of its own, and how to stop
   (Settings › Connections, Revoke). Allow or Not now. A legal scope without approved text shows
   "not ready yet" and no Allow.
3. **Allow** (`startConnect`): consent to every scope the connector asks for, then either the partner's
   own step (`Connector.connect`, which returns an https page and gets Jane's own return address,
   built from APP_URL or AUTH_URL, never from the request) or, without one, the read at once.
4. **The way back**, `/settings/connections/<id>/return?from=`: reads if the consent still stands, then
   back to the card (`safeReturnPath`: a path on Jane only) with `?connected=<id>`.
5. **Audit**: `connector_consent_granted`, `connector_connect_started`, `connector_credential_stored`
   (the partner's link kept in the vault), `connector_connect_returned`, `connector_data_read`,
   `connector_connect_declined`, and on revoke `connector_consent_revoked` and
   `connector_credential_deleted`.

## The action pipeline

`src/lib/connectors/pipeline.ts` is the only way anything happens through a connector. The table
is `connector_actions`; every move between statuses is a compare-and-set on the status before it,
so two taps, two job runners or a retry can't act twice.

| Step | What happens | Status after |
| --- | --- | --- |
| `planAction` | The connector fills in the steps from what was asked. Nothing is sent. Needs the flags, consent and the per-action cap. The caller's idempotency key returns the same plan if asked again, and refuses it for anything else | `awaiting_yes` |
| `answerAction` | A yes carries the amount and fingerprint (SHA-256 of connector, kind, amount and details) the person saw, and counts only if both match. Checks again, plus the daily caps. Queues a `connector_execute` job on the existing jobs queue for after the hold. A no ends it | `approved` or `declined` |
| Hold | `CONNECTOR_HOLD_MINUTES`: a day for money (the stand-in's one-day undo), 10 minutes otherwise. `cancelAction` cancels in Jane, whatever the flags say | `cancelled` |
| `executeAction` | Claims it (`approved` to `running`), then every check again as late as possible: flags, kill switches, who the person is, consent, the stored action unchanged since the yes, the caps, and `REAL_MONEY_MOVEMENT` for a real connector that moves money. Then the connector acts inside the grant, with `jane_<action id>` as the partner's idempotency key. A dry run stops before acting. Not retried on failure: the partner may have acted | `succeeded`, `partner_pending`, `refused` or `failed` |
| After | `cancelAction` again, at the partner, while its `cancelUntil` allows. Revoking consent cancels anything not yet run | `cancelled` |

Every step writes to `audit_log` (`connector_action_*`) and `analytics_events`. Caps live in
`src/config/connectors.ts`: `CONNECTOR_ACTION_CAP_CENTS`, `CONNECTOR_DAILY_ACTIONS`,
`CONNECTOR_DAILY_CENTS`, `CONNECTOR_PLAN_HOURS`. `/settings/connections` lists the person's
actions with the steps, Yes and No, and Cancel while it can still be taken back.

## Webhooks

Every connector's webhooks come to `/api/connectors/<id>/webhook` (`src/lib/connectors/webhooks.ts`),
a 404 unless `CONNECTORS=1`. In order:

1. **The provider's signature**, with its own secret from the env var its connector names
   (`webhook.signing`): HMAC-SHA256 of `<timestamp>.<body>` in the provider's headers, or in one
   `t=<seconds>,v1=<hex>` header (PostGrid, Stripe), or Svix's
   (Resend and others), checked with the same code as the weekly email's webhook. A delivery signed
   more than `WEBHOOK_TOLERANCE_SECONDS` away from now is refused, so an old one can't be replayed
   later. Over `WEBHOOK_MAX_BYTES` is refused before anything is read.
2. **Replay protection**: each event id (or the body's hash, if the provider sends none) is kept in
   `connector_webhook_events` for `WEBHOOK_EVENT_DAYS`. A repeat is acknowledged and ignored. If
   handling fails, the id is forgotten, so the provider's retry is handled.
3. **Per-person routing**: the event names the partner's own id for the action (`externalRef`); the
   action found by connector and that id says whose it is, and everything after goes through that
   person's scoped door. An id Jane hasn't stored yet (a fast partner can answer while `act` is
   still returning) is forgotten and answered 409, so the provider's retry lands once it is; a 200
   would lose a failed payment for good. An id that's never Jane's is retried until the provider
   gives up.
4. **The move**: `applyPartnerEvent` moves the action on only from a status where that makes sense
   (`partner_pending` to `succeeded` or `failed`; `succeeded` to `reversed`, as money can come back
   weeks later; `succeeded` to `undone` for what isn't money and didn't hold, like a letter
   returned to sender), audited and counted.

A kill switch doesn't stop webhooks: they record what the partner already did and act on nothing.
A body over the limit is refused on its `Content-Length` before it is read.

## Sandbox adapters

`src/lib/connectors/sandbox/adapters.ts`: four simulated partners, each shaped like the partner the
connector plan picked, so the whole path runs on sample data. Each calls nobody (a test reads their
code and another blocks every request while they run), says "Simulated: nothing real was sent.",
and is offered only to sample-data people.

| Id | Does | Moves money | Cancel |
| --- | --- | --- | --- |
| `sandbox_bill_pay` | Pays a bill from the person's account (Spinwheel Pay or Method later) | Yes | 15 minutes, Spinwheel's window |
| `sandbox_own_transfer` | Moves money between two of their own accounts (Dwolla or Astra later) | Yes | 15 minutes |
| `sandbox_subscription_cancel` | Cancels a subscription (Jane's email agent, then Pinwheel) | No | No |
| `sandbox_insurance_quote` | Asks for quotes in their name, never buys (Coverage Cat or Canopy later) | No | No |
| `sandbox_letters` | A certified letter to a company: a cancellation by written notice or a stop-payment notice, shaped like PostGrid in test mode | No | Until midnight Eastern, PostGrid's window |

Fakes for tests live in `src/lib/connectors/__fixtures__/`: a pretend real connector, a webhook
signer, and people (real, sample, trial).

## The safety rails, and where each is tested

| Rail | Test |
| --- | --- |
| A real account never moves money while any lock is shut; with all open, only after its yes on that exact action and amount | `safety.integration.test.ts` 1 |
| Trial people never reach a real connector, even with every lock open, even with a forged approved row | `safety.integration.test.ts` 2 |
| Each action runs once under concurrent taps and runners | `safety.integration.test.ts` 3, `pipeline.integration.test.ts` |
| Nobody reaches another person's consent, credential or action | `consent-vault`, `pipeline` and `webhooks` integration tests, and the access proof over every route |
| The flags are off in code, and a real connector's switch is never read from env | `registry.test.ts` |
| Sandbox adapters call nobody | `sandbox/adapters.integration.test.ts` |

## What's next

Real partners, one at a time, each needing a contract, counsel's answer and the founders' word
before its `REAL_CONNECTORS` switch: see `connector-infra.md` in the shared notes for the list and
the open questions.

## Cancelling: the route the merchant allows

`src/lib/connectors/cancel/route.ts` picks how a subscription gets cancelled, from
`src/config/cancel-methods.ts` (56 merchants, from the connectors-roadmap research's round 7, each
with its sources). Only 3 of the 56 document cancelling by email, so steps come first:

1. **App-store billing**: a charge whose descriptor says `APPLE.COM/BILL` or `GOOGLE *` can only be
   cancelled in that store, whatever the merchant's own route, so the store's steps win.
2. **A known merchant**: its own route. `email` only where its page takes a cancellation by email
   (Equinox, Blue Apron); `letter` where written notice is the way (LA Fitness); a phone-only
   merchant gets its steps, since Jane makes no calls.
3. **Anyone else**: plain guided steps.

A guided or app-store cancel ends `handed_off`: nothing for Jane to send, and the last step is the
person's. `sandbox_subscription_cancel` uses the route; nothing real is emailed or mailed.

## "Jane prepares, you pay"

`manual_bill_pay` (`src/lib/connectors/manual-pay/`) is the first real connector, and it reaches
nobody: Jane works out the amount and the day, fills in the steps and the biller's own pay page from
`src/config/billers.ts` (47 billers, roadmap round 8, with sources), and the person pays it
themselves. Jane never moves the money or types an account number. It's off until its switch in
`REAL_CONNECTORS`.

- **Day**: three business days before the due date, five through a bank's own bill pay, never
  before today, before 7 PM ET.

Nothing here rests on what the caller sends (security review on #1506): the connector's `prepare`
and `guard` hooks, which the pipeline runs at plan time, at the yes and before handing it over,
check the person's own data.

- **The account**: `fromAccountId` must be one of theirs, and the name shown comes from that row.
- **Autopay guard**: no manual payment where autopay already pays (an autopay line from that biller
  in the last 45 days), since Chase's mortgage autopay still withdraws after a manual payment. Buy
  now, pay later pays itself, so it's always refused.
- **No twin**: a second open payment of the same bill and due day is refused.
- **Settlement**: `settleManualPayments` marks a bill paid only on a line out of that account, of
  the exact amount (or that plus the biller's documented fee), in the biller's window (usually 3
  business days), that names the biller. An amount-only match stays handed off with "Looks paid
  on ..., check it's this bill". A bank line settles one payment at most, ever: it's claimed in
  `connector_webhook_events`. A match moves the action from `handed_off` to `succeeded` through
  the same door a partner's webhook uses. The nightly controller's money step
  (`src/lib/controller.ts`) runs it while `CONNECTORS=1`.

`manual_own_transfer` is the same for a move between two of the person's own accounts: Jane fills in
from, to, amount and day, the person moves it in their bank's app, and Jane checks both sides.
Both accounts must be the person's own, named from their rows, never from the request (security
review on #1508), and a second open move of the same amount between the same accounts on the same
day is refused. It settles only when both lines show: out of one, the same amount into the other,
within three business days, each line used once. Off until its switch.

## What a person agreed to

Each consent row keeps exactly what the person was shown (`shown_text`: one line per scope), a
version of it (a hash, so the same words always give the same version and changed words a new one),
and the IP address and browser they agreed from. The connections page shows the words under "What
you agreed to", for current and revoked consents. Three scopes are legal texts, not Jane's words
(`EXACT_TEXT_SCOPES`: `soft_credit_pull` for FCRA, `ach_debit_authorization` for Nacha,
`tax_7216_disclosure` for IRS 7216): a connector asking for one must carry the partner's and
counsel's approved text in `consentText`, stored word for word, or the grant is refused. Jane writes
none of them. Still open for those: emailing the person a copy, Nacha's two-year retention after
revoking (account deletion removes the rows today), and 7216's one consent per use.

## "Jane shows, you open and move it"

`manual_open_savings` (`src/lib/connectors/manual-pay/savings.ts`, roadmap round 13's Path A): a
better savings account from the team's reviewed options (`/admin/options`), opened by the person on
the bank's own page; the bank then pulls the opening deposit from their checking itself. Jane holds
nothing, moves nothing and opens nothing. Off until its switch.

- **Checked against the database, not the caller**: the option is a reviewed savings option with an
  https sign-up page and a rate checked within `SAVINGS_APY_STALE_DAYS`; the account is the
  person's and holds the amount; one opening per option at a time.
- **Every Claude-written sentence** also passes a deposit-insurance check in `src/lib/guardrails.ts`
  (`deposit_insurance`, in both profiles): never "Jane is a bank" or FDIC insured, never money
  "with Jane" insured, never a Treasury, fund, stock or crypto FDIC insured.
- **The card**: the rate as "Annual Percentage Yield (APY) X.XX% as of <day>" with the Reg DD lines
  (`src/lib/apy-disclosure.ts`), the steps (open, link, let the bank pull it), and "Jane is not a
  bank and never holds your money", pointing to the FDIC's BankFind. It never says FDIC insured:
  options don't record the insurer yet.
- **Settlement**: a line out of that account, of the exact amount, within five business days,
  naming the bank. A same-amount line without the bank's name doesn't count.

## A person's own credit report

`credit_upload` (`src/lib/connectors/credit-upload/`, roadmap round 9) is read only, with no vendor:
the person gets their free weekly reports at AnnualCreditReport.com and types in a free score.
Nothing is pulled from a bureau. Off until its switch, and saving needs their `read_credit` consent.

- **What's kept** (`validateCreditUpload`): bureau, report date, open cards' limits and balances,
  oldest and average age, hard inquiries in 12 months, late payments by 30/60/90 days in 24 months,
  and collections (creditor, amount, medical). Anything else a reader returns (name, address, SSN,
  account numbers, tradelines) is dropped; a creditor with a long digit run or an @ is refused.
- **The score** (`validateScore`): a model from `CREDIT_SCORE_MODELS` (FICO Score 8, VantageScore
  3.0 and 4.0), within its range, dated within `CREDIT_SCORE_MAX_AGE_DAYS` and not in the future.
- **What Claude may see** (`creditForLlm`): numbers and the model's label only, never a creditor's
  name or any text from the report.
- Saved as a `credit_reports` row with partner `upload`. Not built yet: reading the PDF itself (a
  `credit_report` document kind through the existing extractor, budget permitting) and the page.

## Insurance referrals: how Jane may be paid

Round 14 of the connectors roadmap, on the existing referral partners (`src/lib/referrals.ts`,
`/admin/partners`). Each partner has a `payModel` (`none`, `flat_click`, `flat_lead`, `per_quote`,
`per_policy`) and the insurance `lines` it compares. For insurance:

- Nothing is offered until counsel's answer is recorded (`COUNSEL_INSURANCE_REFERRALS.approved`).
- Unpaid partners then follow the state list as before. A flat fee or per-quote pay also needs
  that pay model approved for the person's state (`approvedStates`, empty today).
- Per policy sold is never allowed: refused at `/admin/partners`, and skipped if a row says so.
- The card shows the partner's disclosure and then how Jane is paid, word for word
  (`PAY_DISCLOSURES`), for example "Jane isn't an insurance agent and isn't paid for this."

Renewal reshops come by kind (`RESHOP_DAYS_BEFORE_RENEWAL_BY_KIND`): home and renters from 45 days
out, auto from 30 (California's renewal offers arrive 45 and 20 days ahead), never life, and never
within the last week (`RESHOP_LAST_CALL_DAYS`) unless the price already rose. The demo's auto
policy now renews in 25 days, inside its window.

Not built yet from round 14: the postback receiver and the banned-phrase check on card copy.

`src/lib/referral-links.ts` builds an affiliate-network link (Impact, CJ, Awin, FlexOffers) that
carries nothing about the person: the only thing added is a sub-ID, the first 16 hex of an HMAC of
the action's id; a template or deep link with a parameter that could carry the person (Impact's
`p.*`, `sharedid`, email, name, phone, zip, date of birth, VIN, user id, or a value that looks like
an email or phone number) is refused, and a deep link may only point at the partner's allowed
domain. Not wired to `/admin/partners` yet: partners don't record their network.

## A person's federal student loans

`my_aid_upload` (`src/lib/connectors/my-aid/`, roadmap round 15) is read only, with no vendor: the
person downloads "Download My Aid Data" from studentaid.gov, a plain-text file of `name:value`
lines. `parseMyAid` reads it in memory and keeps each loan's fields (type, balances, rate, repayment
plan and code, scheduled payment, IDR anniversary, next due date, PSLF months, status, loan date,
disbursed amount, servicer); the person's name, address, phone and email are dropped and the file is
never stored. Values are read loosely (the 2022 layout doesn't pin their formats), and an unknown
plan code stays as it is. `myAidForLlm` gives Claude numbers, codes and plan or status names only,
never the servicer and no date finer than a month. Off until its switch; reading needs
`read_accounts` consent and is audited with the number of loans only. Not built yet: saving the
loans into the student-loan lane's tables and the upload page.

## Loan links

`src/config/loan-links.ts` (roadmap rounds 14 and 15) is the one list of links Jane gives for a
loan: studentaid.gov's own tools (reused from `STUDENT_STEPS`), the home pages of the private
student refinance lenders round 15 names (demo advice mode only: naming lenders is a pick, and
`REAL_ACCOUNT_ADVICE` stays false), and Engine's hosted page, empty until Engine gives its address.
Every one is unpaid (`paid: false`): the beta takes no pay for any loan product. A test holds every
link, and every URL written anywhere in `src/config`, to carrying no affiliate tag (`subid`,
`clickref`, `irclickid`, `utm_*`, Impact's `p.*` and the like) and nothing about the person.

## Pay stubs and employer (Pinwheel)

`pinwheel_payroll` and its sandbox twin `sandbox_pinwheel_payroll` (`src/lib/connectors/pinwheel/`, built
from docs.pinwheelapi.com on 2026-11-19: API Overview, Core Data Technical Implementation, Webhook
Signature Verification, Sandbox) read a connected payroll account's employment and newest pay stubs
(`GET /v1/accounts/{id}/employment` and `/paystubs?limit=3`, `x-api-secret` and `Pinwheel-Version:
2025-07-08`, the Sandbox host unless `PINWHEEL_ENV` says development or production). The newest stub, as
Jane's `Paystub`, goes through `saveBenefitsFromStub` (`src/lib/insurance/benefits.ts`, the same code as
the demo's stub). Each deduction that reads as cover through work is saved as a found benefit for the
person to confirm, never twice. How often pay comes is read from the gap between pay dates, since
Pinwheel's income says an amount per unit, not a pay schedule. The scope is the new `read_pay` ("See your
pay stubs and who you work for"). Webhooks: `x-pinwheel-signature: v2=<hex>`, HMAC-SHA256 with the API
secret over `v2:<x-timestamp>:<raw body>` (the new `pinwheel_v2` signing kind). New pay stubs or
employment for the account read again. **Off for real people**: no entry in `REAL_CONNECTORS`. Not built:
Pinwheel Link (its modal, and keeping the account from `account.added`); `payrollFor`'s live reads
(open enrollment, the life and disability question) still use the demo stand-in only; found benefits
stay after a revoke, as the person's own list.

## Card offers (mock)

`src/lib/connectors/card-offers/offer.ts` (roadmap round 15) reads card offers shaped like Engine's
marketplace and shows them the way Regulation Z wants a card's terms shown. Mock only: no partner,
no pay, and named offers stay in demo advice mode.

- `parseCardOffer`: tolerant of Engine's shapes (rates as numbers or "21.99%", both spellings of
  the credit-rating disclaimer, the balance-transfer fee as a bare percent with its minimum read
  from the fee's disclaimer). An offer with no name or no https Rates & Fees page is refused.
- `offerBlock`: one block of same-size lines. Every intro rate says "intro", with its end, the APR
  after and, for a transfer, the fee; the regular APR and whether it varies; the annual fee; the
  Rates & Fees link; "pre-approved" only when the issuer says so.
- `regZProblems`: what's wrong with a block under those rules, for any screen that shows an offer.
- `cardSuggestionExcluded`: no new-credit suggestion while overdue, after a late fee in 12 months,
  within 6 months of a new card, with hardship flagged, or under 21 without independent income; an
  age band is asked once, never a date of birth.

Not built yet: the disclosure component, balance-transfer and rewards-fit maths, the CFPB card-terms
importer, and wiring offers into a card.

## Phone-plan prices from SaveOnPhone (keyless, for the team to check)

`src/lib/saveonphone.ts` reads SaveOnPhone's public catalog (saveonphone.com/developers and its OpenAPI,
read 2026-11-19: "Free access. No account or API key required."), on an admin's press of "Get phone plans
from SaveOnPhone" on /admin/options. The search goes by price alone (`max_monthly_cents`, verified plans
only, ten a page), so no person's data leaves Jane. Each plan is staged in `switch_options` as a plan for
`phone`, **unreviewed**, so Jane compares it only after the team checks it, like any option. Its price is
the higher of the first term's and the renewal's a month, a prepaid term counts as months committed,
and the "gives up" line says new customers only, autopay, paid up front, and taxes and fees on top.
The source is SaveOnPhone's page with its verification date, as their developer page asks. The sign-up
link is the carrier's own page, never SaveOnPhone's affiliate link (no paid referrals). A plan read again
is updated in place by its SaveOnPhone page, and a changed price or term clears its review. Terms:
saveonphone.com/terms (updated 2026-08-23) say nothing against an app reading the public catalog. Public
access is rate limited, so a 429 stops the read.

## Read connectors

A read connector brings a person's data in from a partner and saves it where Jane already reads it,
so the findings that read those tables work unchanged. `readConnector` (`src/lib/connectors/read.ts`)
runs one only when it's usable for the person (`whyUnavailable`) and their consent covers its
scopes, audits it (`connector_data_read`) and counts it. It runs right after the person allows the
connector on `/settings/connections`, and again when the partner's webhook says there's fresh data.
Each vendor has two registrations: the real one, which calls the vendor and reaches nobody until its
`REAL_CONNECTORS` switch, and a sandbox twin that reads the vendor's own documented example for
sample-data people. Tests use a fake `fetch`, never the network.

| Id | Reads | Into | Finding it feeds | Vendor docs read |
| --- | --- | --- | --- | --- |
| `canopy_connect`, `sandbox_canopy_connect` | Personal policies from the person's insurer: kind, carrier, premium, term, deductible, limits, renewal date (`GET /teams/{team}/pulls/{pull}`, Basic auth; webhook `canopy-signature` `t=,s=`) | `insurance_policies`, source `canopy`, updated in place on a new pull | The renewal reshop before a car or home renews, and a price rise against the last reshop | docs.usecanopy.com/reference and its OpenAPI, 2026-11-17 |

## Loans and cards from the credit report (Method)

`method_liabilities` and its sandbox twin `sandbox_method_liabilities` (`src/lib/connectors/method/`,
built from docs.methodfi.com on 2026-11-19) read a person's loans and cards found through a
soft-pull credit report, **federal student loans included** (the servicers Plaid dropped in August
2024), into Jane's own `accounts` (source `method`) and `liabilities`. The Loans pages, the payoff
planner and the student-loan cards read them like Plaid's. A credit-report figure is a snapshot as
of the lender's last report; Method marks which came straight from the lender (`direct`). A card's
rate given as a range is left unknown, and a federal loan is never called a Direct Loan, because
Method doesn't say so. Each account is tied to the person's connection, so revoking it takes them
back. The real one needs `soft_credit_pull`, an exact-text scope whose words Method and counsel
haven't given, so nobody can consent to it; it also reaches nobody until
`REAL_CONNECTORS.method_liabilities`. The person's identity check and Connect aren't built. Method's
"Sandbox" environment carries live data, so anything but production uses its mocked Development
environment.

**The soft-pull lock.** `COUNSEL_SOFT_PULL` (`src/config/connectors.ts`, code only) holds any real connector
that asks for `soft_credit_pull` back from every real person, answering `needs_counsel`, even if
`REAL_CONNECTORS` lists it. It opens only when counsel's sign-off is recorded there and the approved
words are added as the connector's `consentText` (`soft-pull-lock.test.ts`).

## IRS transcripts (Chart), sandbox only

`sandbox_chart_transcripts` (`src/lib/connectors/chart/`, built from developer.trychart.com and its
OpenAPI definition on 2026-11-17) is the transcript partner #1576 was shaped for
(`TranscriptPartner`, `src/lib/tax-transcripts/`): Chart's account transcripts are rendered in the
IRS's layout and read by Jane's one transcript reader, so the codes, Jane's words and what's never
kept (names, TINs) stay as they are. With `CONNECTORS=1` a sample person who allows it gets their
transcripts through Chart's shape. **There is no real Chart connector**: Chart reads the IRS through
the person's own IRS sign-in typed into Chart's flow, and whether Jane may send a person there is
counsel's question. A test holds that no real one is registered or switched on. Chart's client
(`chartHttp`: the code-for-token exchange and `/records`) is built and tested, so that day is a
registration, not a build.

## Brokerage holdings, read only (SnapTrade)

`snaptrade_holdings` and its sandbox twin `sandbox_snaptrade_holdings` (`src/lib/connectors/snaptrade/`,
built from docs.snaptrade.com on 2026-11-19: Request Signatures, Register User, Generate Connection
Portal URL, List All User Accounts, List All Account Positions, Sandbox and Webhooks) read a person's
brokerage accounts and positions into Jane's own investment accounts (`source: snaptrade`), securities
(`snaptrade:<ticker>`) and holdings, in Plaid Investments' shape: Plaid's security types, value and the
position's total cost basis in cents (SnapTrade's is per share). Options, futures, CFDs, tokenized
assets and positions in another currency are left out and counted; the account's total is SnapTrade's
net value. Paper, closed and archived accounts aren't read. Accounts carry the connection; revoking
removes them and their holdings.

Read only: the Connection Portal link (`snaptradeConnectLink`, not on a page yet) asks for
`connectionType: "read"`, the scope is `read_holdings`, and nothing places, previews or cancels an
order. Each person gets a SnapTrade user under an id Jane makes up, kept with its secret in the vault;
that id is the link's ref for SnapTrade's webhooks (`Signature` over the body's canonical JSON with the
consumer key, and `eventTimestamp` within five minutes). Fresh holdings read again; a broken or fixed
connection is a link event. **Off for real people**: no entry in `REAL_CONNECTORS`. Not built: deleting
the SnapTrade user on revoke (SnapTrade's Delete User), cash balances (List Account Balances).

## A letter that lets Jane act for the person (SignWell)

`signwell_permission` and its sandbox twin `sandbox_signwell_permission`
(`src/lib/connectors/signwell/`, built from developers.signwell.com on 2026-11-17) prefill and, after
the person's yes, send them a letter to sign that lets Jane act for them with one company: one of a
fixed list of tasks (cancel, ask for a lower rate, dispute a charge, ask about the account), for a
year unless they pick less (never past three), and never anything that moves money. Who signs and
which company come from Jane's own records: the person's name and email on their profile, and a
company Jane knows (`src/config/cancel-methods.ts`). The signed letter, with SignWell's audit trail,
is the record behind an act. Consent scope `sign_letters`; category `permission`.

SignWell's webhook carries an event hash, HMAC-SHA256 keyed by the webhook's id over
`<type>@<time>` (signing kind `signwell_event_hash`, checked within `WEBHOOK_TOLERANCE_SECONDS`).
It doesn't cover which document, so the real connector stays off until a "completed" is confirmed
with Get Document first (`api.get` is built). Letters are test-mode (not binding) unless
`SIGNWELL_ENV=production`. Counsel reads the letter's words before any real person signs one.

## Letters through PostGrid's test mode, sandbox only

`sandbox_postgrid_letters` (`src/lib/connectors/postgrid/`, built from postgrid.readme.io on 2026-11-19:
Create Letter, Cancel Letter, Getting Started, Manually Verifying Webhook Signatures) is the sandbox's
letter made at PostGrid in test mode, where "none of the orders made in test mode will be sent out". It
keeps `sandbox_letters`' checks: the person's own name, and only a company Jane knows takes a letter, at
its documented address (parsed into PostGrid's contact fields). The letter is plain HTML, certified, with
Jane's idempotency key in its metadata, since PostGrid has none of its own. It can be stopped until
midnight Eastern (`DELETE`, while `ready`). Only `POSTGRID_TEST_API_KEY` is read; a key starting `live_` is
refused before any call, and a letter that comes back `live` is cancelled at once. The return address
is PostGrid's own documented example contact, because Jane keeps no mailing address for a person. A trial
person's letter stays in the plain sandbox, which calls nobody. Webhooks: `PostGrid-Signature:
t=<unix milliseconds>,v1=<hex>`. The `t=,v1=` signing kind now takes `timestampUnit: "ms"`; the
sandbox's PostGrid-shaped signature moved to milliseconds too, since a 13-digit t was refused before.
**There is no real PostGrid connector**: it needs the person's mailing address, a live key and
`REAL_CONNECTORS`.

## Investing through Alpaca's Broker API, sandbox only

`sandbox_alpaca_account` (open an Individual, Roth or Traditional IRA account; turn on the FDIC cash
sweep) and `sandbox_alpaca_order` (a market buy by dollar amount) are built from docs.alpaca.markets
(Getting Started with Broker API, Create an Order for an Account, Cancel an Open Order and the FDIC
Sweep Program, read 2026-11-17). Both move money (`movesMoney`), so a real one would need
`REAL_MONEY_MOVEMENT`; a buy is a pick (`recommends: "investment"`), held back from any real person
until `HUMAN_REVIEW_READY`; crypto is refused at the plan and at the order by the brokerage's own
`refuseCrypto`. **There is no real Alpaca connector**, and `REAL_TRADING` (`src/config/connectors.ts`,
code only) is false. Alpaca's client (`alpacaBrokerHttp`: a buy with Jane's `client_order_id`, and a
cancel) only ever points at the sandbox host. Not built: opening an account for real (Alpaca's request
carries the person's government id, date of birth and identity documents: counsel and a design of its
own) and the sweep enrollment call (described in Alpaca's blog, not its reference). The paper account
(`src/lib/paper/`) stays simulated money with its own pop-up and never reaches these.

## Money between a person's own accounts (Dwolla's Sandbox), sandbox only

`dwollaSandboxPartner` (`src/lib/money-movement/dwolla/`) is a `MoneyMovementPartner` built from
developers.dwolla.com (Create an application access token, Initiate, Retrieve and Cancel a transfer,
Transfer Lifecycle, Testing in the Sandbox, read 2026-11-19). Only the Sandbox host
(`DWOLLA_SANDBOX` in `src/config/money-movement.ts`) is in code; there is no production one, and
`REAL_MONEY_MOVEMENT` stays false. `moneyPartnerFor` never returns it, so nobody's transfers reach it:
tests and a founder's own Sandbox run pass it in as `partner`.

The one-day undo stays in Jane's queue. Scheduling sends Dwolla nothing (the ref is `JANEQ-…`), and an
undo before the day is Jane's alone. On the transfer's day `settleTransfers` releases it to Dwolla
through the partner's `release`, with the queue ref as Idempotency-Key and correlationId, so a retry
never makes a second one. After that an undo asks Dwolla to cancel, and is refused once Dwolla says
processing began. A transfer completes when Dwolla says `processed`. Dwolla's Sandbox runs no ACH: a
transfer stays `pending` until a Sandbox simulation processes it.

Not built: a Dwolla Verified Customer for the person (their identity) and verified funding sources for
each account (`fundingSource` maps them per account); payments to someone else (a bill); Dwolla's
webhooks (signed with `X-Request-Signature-SHA-256` over the body alone, no timestamp), since the status
is read on the transfer's day; marking a `failed` or `cancelled` transfer at Dwolla as failed in Jane.

## The agent's phone calls in test (Retell)

`src/lib/voice/retell/` puts Retell (docs.retellai.com, read 2026-11-19: Create Phone Call, Get Call,
Secure the webhook, Post Call Extraction) behind the action agent's calls, in test only. With
`VOICE_PROVIDER=retell_test` and `RETELL_API_KEY`, `RETELL_AGENT_ID` and `RETELL_FROM_NUMBER` set, an
approved bill negotiation in simulated mode is called through Retell instead of the simulated job: always
the simulated company's fiction number (`RETELL.simulatedCompanyNumber`, +1 202 555-0100, checked against
the fiction range, toll-free excluded), the script and company as dynamic variables, the action's reply
token as metadata, and `jane-<action id>` as Retell's idempotency key. Real companies stay uncalled:
`callMode` is still off for real people in production. Trial people never reach Retell; the simulated job
answers them.

Retell's `call_analyzed` webhook (`POST /api/voice/retell`, `X-Retell-Signature: v=<ms>,d=<hex>`,
HMAC-SHA256 with the API key over the raw body and v, within five minutes) gives the result to
`handleCallResult` by that token. The test agent's post-call extraction says the outcome in Jane's words
(`outcome`, `new_monthly_cents`, `offer`, `offer_monthly_cents`, `offer_contract_months`,
`offer_fee_cents`); a failed dial is `no_answer`, and anything unclear needs a person. A fiction number
answers nobody, so a test call ends as `no_answer` unless the simulated company is played by a number of
its own (a Retell number with a second agent: a purchase, the founder's call).


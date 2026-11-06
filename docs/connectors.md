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
   (`webhook.signing`): HMAC-SHA256 of `<timestamp>.<body>` in the provider's headers, or Svix's
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
   weeks later), audited and counted.

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

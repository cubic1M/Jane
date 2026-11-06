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

# Turning on the email agent for real accounts

**It is off.** `CONCIERGE_ACTIONS.realAccounts` (`src/config/concierge.ts`) is false, so every step of
the agent on a real account is refused by the permission check (`src/lib/permission/check.ts`) with
the reason `read_only`, and a Yes stays do-it-yourself. This page says what has to be true first. It
is a map for the founders and counsel, not legal advice.

## How the agent acts now

`src/lib/agent/run.ts` works an action that has a person's yes. It finds the company's support
address, emails it, reads the reply, follows up and checks refunds. Every message to a company goes
through one check first, and `sendAgentMail` won't send outside it:

| The check asks | For the agent |
| --- | --- |
| Stop-all switch | Off. On, the action waits and the follow-up run tries again the next day |
| May this person have it | Demo bank and sample people, simulated. Real accounts: only with the flag on |
| Their yes or a standing limit | The decision on the action must still be a yes, not undone |
| A cap | Emails commit no money: nothing to cap yet |
| An undo window | `AGENT_HOLD_HOURS` holds approvals made outside the app. A yes in the app starts at once. **Decide this before real mail**: the roadmap asks for a window on every standing permission |
| `audit_log` | `jane_act_allowed` or `jane_act_refused` for every message |
| The record | `jane_acts`, shown on `/jane` under "Everything Jane did" |

A trial person always gets the simulated company (`mailMode` in `src/lib/agent/mail.ts`), never a real
address.

## What only the founders can do

1. **Form the legal entity.** The agent writes as a company on the person's behalf, so there has to
   be one. `COMPANY_NAME` and the Terms name it.
2. **Have counsel write the agency wording.** `docs/legal/README.md` item 4 says the Terms need it
   first. Counsel should cover:
   - what the person authorizes Jane to do for them, for each kind of action (cancel, ask for a
     refund, dispute, ask for a lower price);
   - whether that needs one consent per action or can be a standing one, and how it's taken back;
   - how the email identifies Jane and the person to the company;
   - what a company may ask that Jane must pass back rather than answer;
   - what happens when Jane gets it wrong.
3. **Set up mail.** Real sending needs all three of `RESEND_API_KEY`, `EMAIL_FROM` and
   `AGENT_INBOUND_DOMAIN`, and `AGENT_INBOUND_SECRET` for the route below. Then:
   - verify the sending domain in Resend (production's health email is being refused today with
     "You can only send testing emails to your own email address", so it isn't verified yet);
   - point `AGENT_INBOUND_DOMAIN`'s inbound mail at `POST /api/agent/inbound` as JSON
     `{ to, from, subject, text }` with `Authorization: Bearer <AGENT_INBOUND_SECRET>`, mapping the
     provider's fields from its own webhook docs.
4. **Fill in support addresses.** The agent writes only to a `supportEmail` the team confirmed in
   `/admin/merchants`, never a guess. Today 14 of the 21 companies in the directory only cancel from
   the person's own account.

## What's left to build

- **Who takes a hand-off.** A hand-off still reads "passed to our team", and there is no team: the
  concierge was dropped. It should go back to the person with the steps and drafts.
- **A way to handle mistakes.** The roadmap asks for this before the first real email: how a person
  reports one, and how it's counted (the gate to Stage 3 tracks a mistake rate).
- **The undo window above**, and which actions start at one yes each (the roadmap starts with
  cancellations and fee refund requests).
- **A real-account test.** With the flag on, walk one action on a test address end to end, reply
  included, before any real company gets an email.

## Turning it on

Only after all of the above and counsel's sign-off: set `CONCIERGE_ACTIONS.realAccounts` to true. That
one change also turns on the concierge queue for real accounts (`src/lib/concierge-mode.ts`), so split
the flag first if the queue should stay off. `src/lib/permission/check.integration.test.ts` fails while
the flag is on: change it in the same pull request, with counsel's sign-off named in it.

# Moving money: what's built, and what it still needs

**Off.** `REAL_MONEY_MOVEMENT` is false, and turning it on is a code change. A real account has no money partner at all, exactly as before. Nothing below has been run against a real API: no keys, sign-ups or live calls. Provider picks come from `connector-plan.md` in the shared notes. Not legal advice.

## The order

Set in `src/config/money-rollout.ts`, enforced by the permission check.

1. **"Jane prepares, you pay"** (`src/lib/money-movement/prepared.ts`). No vendor. Jane keeps the instruction and reminds the person, they pay from their own bank, and later data shows it. The only route verified to keep money away from Jane.
2. **Card and bill payments through a partner**, a yes on every payment (Spinwheel, `adapters/spinwheel.ts`).
3. **Cash between a person's own accounts** (Dwolla, `adapters/dwolla.ts`). `PAYMENT_ROLLOUT.ownAccounts` is false.
4. **Payments under a cap**, with no yes each time. `PAYMENT_ROLLOUT.underCap` is false.

`PAYMENT_REHEARSAL=1` walks steps 1 and the rules on the demo bank.

## How a vendor fits

Vendors can't hold Jane's one-day undo: Spinwheel deletes a request only within about 15 minutes of creating it, and Dwolla cancels only while pending. So `schedule` only queues (`queue.ts`), the undo is Jane's, and `dispatchDue` calls the vendor on the run-on date, through the permission check again, with the safe-to-spend cushion checked again. A vendor's own ids for a person's accounts live in `partner_links`, and nothing is guessed: not linked means it isn't sent. `settled` comes from the vendor; a payment can still come back (`watchForReturns`, up to about 60 days).

## Before any live build

**Only the founders can do these:**

- Form the legal entity. Dwolla requires a US entity in good standing.
- Get counsel and the vendors to answer the funding question: Spinwheel's docs show the end user as payer, but funds go to "an FBO (for benefit of) account dedicated to your funds", and Dwolla's own-account move goes through a Balance. Neither is cleared against "money never passes through Jane".
- Talk to Spinwheel first, then Dwolla, with Method as backup. Prices aren't public.
- Sign the contracts, get keys, add Plaid Auth for processor tokens.
- Prepare for what they'll ask for: a security review, a fraud and error process, insurance.

**Still to build then:** onboarding that fills `partner_links`, webhooks in place of polling, and a call to `dispatchDue` in the nightly run. Check in each sandbox: Spinwheel's `amount` units (not stated; dollars assumed) and Dwolla's full list of statuses.

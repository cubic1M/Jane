# Legal drafts for the closed beta

`/terms` (`src/app/terms/page.tsx`) and `/privacy` (`src/app/privacy/page.tsx`) are drafts in
plain language, written from what the app does today. Both pages carry a "Draft for the closed
beta, to be reviewed by a lawyer" notice until `LEGAL_REVIEWED=true` is set
(`src/config/legal.ts`). Changing either page in a way people should agree to again means
bumping `TERMS_VERSION`, which asks every user to accept once on their next visit.

## What the drafts say, and where it comes from in the code

Rewritten 2026-10-26 from the code as it is today (`TERMS_VERSION` 2026-10-26, so everyone accepts
once more). `src/app/legal-pages.test.tsx` checks each claim below against the code it names, so
a change in one breaks the test until the pages say it too.

| Claim | Source |
| --- | --- |
| Sign-up needs an invite (closed beta); Try Jane only "when it's offered" | `BETA_INVITE_ONLY` (`src/lib/launch-check.ts`), `src/lib/auth-gate.ts`; `trialEnabled()` in `src/lib/trial.ts` (production only with `TRY_JANE=1`) |
| Bank access is read-only through Plaid; Jane never moves money | Plaid Transactions, with Liabilities and Investments optional (`src/lib/plaid/link.ts`); no Auth, Transfer or Payment Initiation product |
| Real accounts: you make changes yourself; Jane and the team don't contact companies | `CONCIERGE_ACTIONS.realAccounts = false` (`src/config/concierge.ts`), `src/lib/concierge-mode.ts` |
| Plaid tokens and uploaded documents encrypted with AES-256-GCM | `TOKEN_ENCRYPTION_KEY`, `src/lib/crypto.ts`; `src/lib/documents/store.ts` |
| CSV uploads parsed in memory, never stored as a file | `src/app/import/` |
| What Anthropic receives (chat, card text, check-in, weekly review, uploaded documents, merchant names) and never (passwords, bank sign-in, Plaid connection, account numbers, raw descriptions) | `src/lib/jane-agent/claude.ts`, `src/lib/ask/tools.ts`, `src/lib/explain.ts`, `src/lib/check-in.ts`, `src/lib/strategist.ts`, `src/lib/documents/extract.ts`, `src/lib/tax-notices/read.ts`, `src/lib/prior-return/read.ts`, `src/lib/draft-return/read.ts`, `src/lib/subscription-check.ts` |
| No financial advice for real accounts; demo advice on sample data, labelled | `REAL_ACCOUNT_ADVICE = false` (`src/config/advice.ts`), `src/lib/advice-mode.ts`, `src/lib/guardrails.ts` |
| Practice portfolio and paper account: simulated money only, sample data only for now; prices from Alpaca or Yahoo by ticker | `src/lib/paper/` (`adviceMode` gate), `src/app/investments/practice/page.tsx`, `src/lib/paper/prices.ts` |
| Retention periods | `src/config/retention.ts` (the privacy page reads it directly) |
| Banks disconnected after 60 days unused, with an email 7 days before | `INACTIVE_ITEM_DAYS`, `REMOVAL_WARNING_DAYS` (`src/config/retention.ts`) |
| Delete everything in one step; Plaid first, nothing deleted if Plaid can't be reached; ids-only audit record; /goodbye | `deleteAllData` (`src/lib/account-deletion.ts`), `src/app/goodbye/page.tsx` |
| Trials deleted after `TRIAL_HOURS`, never emailed or counted | `src/lib/trial.ts`, `src/config/trial.ts`, `src/lib/analytics.ts` (`isTrialUser`) |
| PostHog gets event names and some figures, keyed by a random id, from the server, only when configured | `src/lib/analytics.ts` (`POSTHOG_KEY`) |
| Resend sends sign-in links and the emails people opt into | `src/lib/email.ts` |
| Browser push carries notifications when turned on | `src/lib/push.ts` (`VAPID_*`) |
| Cookies: the sign-in cookie; `fc_invite` and `fc_terms` (15 minutes); `fc_aid` (a random id, a year); browser storage for display choices | Auth.js; `src/lib/auth-actions.ts`; `src/app/api/events/route.ts`; `src/components/side-chat/store.ts`, `src/lib/ask-jane.ts`, `src/app/landing-mode-switch.tsx` |
| Contact address | `contactEmail()` (`src/config/legal.ts`): `SUPPORT_EMAIL`, else the first `ADMIN_EMAILS` address, else a "[contact email to be added]" placeholder |

## Claims a lawyer must check

1. **The operator.** "Jane, run by Financial Controller" (`COMPANY_NAME`): the legal entity, its
   address, governing law and venue are missing.
2. **Contact.** Until `SUPPORT_EMAIL` is set the pages show a founder's admin address, or a
   placeholder. Is an email enough, or is a postal address or privacy contact required?
3. **"Jane never moves money" and "read-only".** True of the Plaid products asked for; confirm
   the wording against Plaid's own terms and its production checklist disclosures.
4. **"Jane and our team don't contact companies for you" (real accounts).** True while
   `CONCIERGE_ACTIONS.realAccounts` is false; the demo and trial flow still has a simulated agent.
   The Terms will need agency or authorisation wording before concierge comes back for real
   accounts.
5. **"No financial advice for your real accounts" / "general information".** Is that enough for a
   service that explains people's own money with AI? Do the labelled demo recommendations on
   sample data raise investment-adviser questions?
6. **Practice and paper accounts.** "Simulated money only, … not a forecast". Is that enough
   disclaimer for strategy replays and trade alerts with a confidence percentage, even on sample
   data, and would offering them to real accounts later need registration?
7. **Anthropic.** The list of what Claude receives, and the absolute "never receives …". Should
   the policy describe Anthropic's API retention and no-training terms, and is consent needed
   beyond accepting the policy?
8. **"We don't sell your data" and "not for advertising".** Check against CCPA/CPRA's definitions
   of sale and sharing, including PostHog analytics.
9. **Cookies.** The list (sign-in, two 15-minute sign-up cookies, a year-long random visit id)
   and "no advertising cookies or tracking pixels". Does the visit id need a notice or consent in
   any state we serve?
10. **Retention.** Account data is kept until the person deletes it; banks are disconnected after
    60 days unused; analytics records 395 days; error reports 90 days; the audit log keeps ids-only
    deletion records indefinitely. Are these acceptable, and is "until you delete it" allowed for
    inactive accounts?
11. **Deletion.** "Deletes your account and everything in it" except the ids-only security record.
    Does that meet deletion-request rules (timing, confirmation, backups)?
12. **Trials.** "Deleted after 24 hours" (`TRIAL_HOURS`) and "never emailed, never counted".
13. **Partners and the membership test.** The referral-fee disclosure and "we'll tell you before
    any recurring charge"; insurance referral fees stay off until counsel answers
    (`COUNSEL_INSURANCE_REFERRALS`).
14. **Age, eligibility, invite sharing, suspension, "as is" and the liability limit.** Enforceable
    as written? Is an arbitration clause or class-action waiver advisable?
15. **GLBA and state privacy laws.** Does reading bank data through Plaid make us a financial
    institution needing a GLBA notice? Which state laws apply to an invite-only beta?

## Open questions for the lawyer

1. **Who is the operator?** The pages say "Jane, run by Financial Controller" (`COMPANY_NAME`).
   What is the legal entity, its address, and the governing law and venue for disputes?
2. **Contact email.** `contactEmail()` uses `SUPPORT_EMAIL`, else the sender in `EMAIL_FROM`.
   Is a support inbox enough, or do we need a postal address or a privacy contact?
3. **Not financial advice.** Is the "general information, not advice" wording enough for a
   service that explains people's own money with AI? Do the sample-data "demo advice"
   recommendations, even labelled, raise investment-adviser questions?
4. **Concierge actions.** When someone approves, Jane or our team contacts a company for them
   (for example to cancel a subscription). Do we need a written authorisation or agency wording,
   and limits on what we may say for them?
5. **AI processing.** Anthropic receives financial data to write answers. What should the
   policy say about Anthropic's retention and its no-training commitment for API data, and do we
   need consent beyond agreeing to the policy?
6. **Gramm-Leach-Bliley and state privacy laws.** Does reading bank data through Plaid make us a
   financial institution for GLBA's privacy notice? Which state laws (CCPA/CPRA and others) apply
   to a closed beta of 10–30 people, and what rights wording do they need?
7. **Plaid's requirements.** Plaid's end-user privacy policy and its production checklist ask
   for specific disclosures. Do the drafts cover them before we apply for Plaid Production?
8. **Retention.** Account data is kept until the person deletes it. Is that acceptable, or
   should inactive accounts be deleted after a set time (banks are already disconnected after 60
   days of inactivity)? How long should the audit log keep its ids-only deletion records?
9. **Waitlist.** We store waitlist emails and send nothing. What notice does that need at the
   point of collection, and how long may we keep them?
10. **Liability and warranty.** Is the "as is" beta wording and the liability limit enforceable
    as written, and is an arbitration clause or class-action waiver advisable?
11. **Age and eligibility.** The terms say 18 or older and accounts the person may share. Is that
    enough, and what about household members' joint accounts?
12. **Referral fees and the membership test.** What disclosure do partner fees and the Stripe
    membership test need?

## When the review is done

Set `LEGAL_REVIEWED=true`, bump `TERMS_VERSION` if the wording changed, and update this file
with what was decided.

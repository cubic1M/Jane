# Legal drafts for the closed beta

`/terms` (`src/app/terms/page.tsx`) and `/privacy` (`src/app/privacy/page.tsx`) are drafts in
plain language, written from what the app does today. Both pages carry a "Draft for the closed
beta, to be reviewed by a lawyer" notice until `LEGAL_REVIEWED=true` is set
(`src/config/legal.ts`). Changing either page in a way people should agree to again means
bumping `TERMS_VERSION`, which asks every user to accept once on their next visit.

## What the drafts say, and where it comes from in the code

| Claim | Source |
| --- | --- |
| Sign-up needs an invite (closed beta); Try Jane is open to all | `BETA_INVITE_ONLY`, `src/lib/invites.ts`, `src/lib/auth-gate.ts` |
| Bank access is read-only through Plaid; Jane never moves money | Plaid Transactions, with Liabilities and Investments optional, all read-only (`src/lib/plaid/link.ts`); no payment or transfer product |
| Plaid tokens encrypted with AES-256-GCM | `TOKEN_ENCRYPTION_KEY`, `src/lib/crypto.ts` |
| CSV uploads parsed in memory, never stored raw | `src/app/import/` |
| What Claude (Anthropic) receives | Chat tools (`src/lib/jane-agent/claude.ts`, `claude-tools.ts`), explanations (`src/lib/explain.ts`), document reading (`src/lib/documents/extract.ts`) |
| No investment, tax or legal advice for real accounts; demo advice on sample data, labelled | `REAL_ACCOUNT_ADVICE = false` (`src/config/advice.ts`), `src/lib/advice-mode.ts`, `src/lib/guardrails.ts` |
| Retention periods | `src/config/retention.ts` (the privacy page reads it directly) |
| Delete everything in one step | `deleteAllData` (`src/lib/account-deletion.ts`): Plaid items removed, then every user-owned row |
| PostHog gets event names and some figures, keyed by user id, server-side only | `src/lib/analytics.ts` |
| Resend sends sign-in links and the emails people opt into | `src/lib/email.ts` |
| Sample-data trials deleted after `TRIAL_HOURS`, never in analytics | `src/lib/trial.ts`, `src/config/trial.ts` |

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

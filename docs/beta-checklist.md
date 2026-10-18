# Beta security and compliance checklist: status

Every item from the spec's "Security and compliance checklist", marked as either done in code or needing a person. Written for step 11 (October 2026). Re-check `/admin/launch` on the deployed site before inviting outside users.

## Done in code

| Item | Status | Where |
| --- | --- | --- |
| Plaid access tokens encrypted at rest (AES-256-GCM, key from a secrets manager, never in the repo) | Done. Tokens are encrypted with `TOKEN_ENCRYPTION_KEY`, stored as a sensitive Vercel environment variable. Plaid SDK errors are stripped before logging, because the raw ones carry the token. A test checks that no browser code imports token-handling modules. | `src/lib/crypto.ts`, `src/lib/plaid/client.ts`, `src/lib/plaid/client-bundle.test.ts` |
| Read-only Plaid products only; Transactions alone in the MVP | Done. Link tokens request `transactions` only. | `src/lib/plaid/link.ts` |
| Plaid webhooks verified before processing | Done. The ES256 JWT, body hash and 5-minute age are checked before anything is read. | `src/lib/plaid/webhook-verify.ts` |
| Admin screens behind a role check and MFA; every admin view of user data in the audit log | Done. A proxy returns a real 404 to non-admins. Admins need a TOTP code in each session. Queue, action and metrics views are audit-logged. | `src/proxy.ts`, `src/lib/mfa.ts`, `src/lib/concierge.ts` |
| "Delete all my data" removes every Plaid item (`/item/remove`) and all rows for the user | Done, and checked in Plaid Sandbox: afterwards Plaid answers `ITEM_NOT_FOUND`. A test covers all 21 user-owned tables. | `src/lib/account-deletion.ts` |
| Inactive items removed on a schedule to stop Plaid billing | Done. Warning email at 53 days without activity, removal at 60, run by the daily Plaid job. | `src/lib/plaid/inactive.ts` |
| No investment, tax or legal advice in any card or LLM output; guardrail on LLM text before display | Done. Guardrails reject investment, tax and legal advice, invented dollar figures, and promises. Template text is tested against the same rules. | `src/lib/guardrails.ts` |
| Referral relationships disclosed on any card that uses one | Done in code. A card shows the partner's disclosure line. **Needs a person** to add each partner's wording to `src/config/referrals.ts` when an agreement is signed. | `src/config/referrals.ts` |
| Rate limiting on auth and API routes | Done. Postgres-backed limits on sign-in (per IP and per email), Plaid, decisions, membership, events, unsubscribe and admin MFA codes. A load test gets 429s. | `src/lib/rate-limit.ts` |
| Dependency and secret scanning in CI | Done. `npm audit` (high and critical) runs on every PR, Dependabot opens weekly update PRs, and gitleaks scans for secrets. | `.github/workflows/ci.yml`, `.github/dependabot.yml` |

Also added in step 11, beyond the checklist:
- **Security headers**: CSP allowing only Plaid Link from outside, HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies.
- **Error monitoring**: personal data and secrets are scrubbed out of errors before storing (view them at `/admin/errors`).
- **Invite codes**: the beta stays closed (create codes at `/admin/invites`).
- **Production switch check**: `npm run check:launch`, or `/admin/launch` on the deployed site.

## Needs a person

| Item | What to do |
| --- | --- |
| Counsel has confirmed whether insurance referral fees need a license in your launch state | Ask a lawyer before turning on any insurance referral partner. Until then, keep `insurance_reshop` without a partner (quotes only, no referral fee). |
| Privacy policy and terms published, covering Plaid data use, retention and deletion | Have counsel write or review them, then publish at `/privacy` and `/terms` and link them from sign-up. The facts to cover are in "What the app does with data" below. |
| Plaid's security questionnaire answered truthfully for Production access | Answer it in the Plaid dashboard. The controls listed above are the true answers for encryption, access control, MFA, logging, deletion and vulnerability scanning. |
| Backups enabled and a restore tested once | In Neon: confirm point-in-time restore is on for the production branch, then restore to a new branch, check that a few tables have rows, and delete the branch. Write down the date it was tested. |
| Admins enrolled in MFA | Each person in `ADMIN_EMAILS` signs in, opens `/admin`, and adds the key to an authenticator app. If someone loses their phone, clear `mfa_secret_encrypted` and `mfa_enabled_at` on their user row so they can enrol again. |
| Bill price ranges reviewed | `BILL_BENCHMARKS` in `src/config/detection.ts` holds our own estimates of typical phone and internet/TV prices. Check them against current carrier and provider list prices, and update each range's `source` line. |
| Merchant directory reviewed | Open `/admin/merchants`, check each seeded company's cancel and support links, add typical prices, and tick "I checked these details today". |
| Phone notifications (optional) | Run `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (e.g. `mailto:` your support email) in Vercel. Without them, alerts stay email-only. |
| Plaid Production | `PLAID_ENV` is still `sandbox`. When Plaid approves Production, set `PLAID_ENV=production` and the production secret in Vercel, then confirm `/admin/launch` is all green. |

## What the app does with data (facts for the privacy policy)

- **Data read**: transactions, account names and balances, read-only through Plaid's Transactions product. No money movement.
- **Storage**:
  - Plaid access tokens are encrypted.
  - Uploaded CSV files are parsed in memory and never stored raw.
  - Card text shown to a person is saved with each decision.
- **Shared with Claude (Anthropic)**: only the finding type, merchant names, amounts, dates and the savings estimate. Never account names or numbers, transaction descriptions, emails or tokens.
- **Shared with Claude for Ask Jane**: the person's question, and what Jane looks up to answer it: cleaned-up merchant names, categories, dates and amounts, and the titles of findings and actions. Never raw transaction descriptions, account names or numbers; transfers are shown only as "Transfer". Conversations are stored until the person deletes them.
- **Retention**: linked banks are removed after 60 days of inactivity, with a warning a week before. "Delete all my data" removes everything at once.
- **Audit log**: keeps ids and event names (no personal data) after deletion.
- **Email**: a weekly digest, with one-click unsubscribe. Click tracking is through our own links; no tracking pixels.

# Vendors for logs, errors, alarms and backups: what their terms say

Read on 2026-11-03, for the founders to check before signing up. The pages were read through a
summarising tool, so open them before relying on a line, and this isn't legal advice. None of these
is in use yet, so `/privacy` doesn't list them. Add a vendor there when it's really switched on,
not before.

## Sentry (errors)

[Pricing](https://sentry.io/pricing/), [terms](https://sentry.io/terms/), [DPA](https://sentry.io/legal/dpa/).

- **Free (Developer):** one user, 5k errors, a 30-day lookback. Team is $29/month, or $26 billed
  yearly. Two founders can't both have a login on the free plan.
- **Personal data:** section 4.4 says that unless a DPA is in place, the customer "will not submit
  any Personal Data to the Service". Section 5.2 bars Sensitive Personal Information, which includes
  card data under PCI DSS.
- **The DPA isn't automatic.** You accept it electronically. The steps are in a help article behind
  a sign-in, so I couldn't read them or confirm the free plan qualifies.
- **Free products (section 17):** no warranty, no support, liability capped at US$50. Use lasts for
  the period Sentry designates, or 30 days if none is set. I couldn't tell which applies to the
  Developer plan, so check it.
- **Commercial use:** I found no ban. Section 2.1 limits use to "internal business purposes".

**What Jane sends** (`src/lib/sentry.ts`): the kind of error, its cleaned message with ids removed,
code locations and a path with ids removed. No user, no request, no IP address. That's meant to stay
outside "personal data", but a message could still hold something the cleaning misses, so accept the
DPA anyway if it's open to you.

**Why not Sentry's SDK:** `@sentry/nextjs` rewrites the build even when it's off, and that's a change
to production. Plain HTTP to its documented envelope address changes nothing until `SENTRY_DSN` is
set. The cost: no browser errors, no source maps (so minified names), and only request errors and
failed jobs are sent. Failures caught and logged with `log.error` reach the logs, not Sentry.

## Axiom (log storage, through a Vercel drain)

[Pricing](https://axiom.co/pricing), [limits](https://axiom.co/docs/reference/limits), [terms](https://axiom.co/terms).

- **Free (Personal):** 1 user, 30 days' retention, 500 GB a month of data loading, 3 monitors,
  notifications by email or Discord only. Axiom Cloud is $25/month plus usage.
- **Can a company use Personal?** The flagged question, and I can't settle it. The pricing page says
  "For individual developers and small projects", which describes who it's for. The terms don't
  mention free plans or limit them to non-commercial use, and they point to a Service Description I
  didn't read. **Ask Axiom in writing,** or use the paid plan.
- **Personal data:** section 1.8 says that by making PII available you agree to Axiom's DPA, so it
  appears to apply without a separate signature. Section 1.4 makes you responsible for complying
  with data laws.
- **After you leave:** data "may be irretrievably deleted after fifteen (15) days".

## Vercel (where the logs come from)

[Drains](https://vercel.com/docs/drains), [runtime logs](https://vercel.com/docs/logs/runtime).

- Drains need **Pro or Enterprise**. Hobby and the Pro trial can't use them.
- **$0.50 per GB,** measured on uncompressed JSON, so it can be more than Axiom reports receiving.
- I found no setting that removes content from what's drained, which is why `src/lib/log.ts` cleans
  it first (`docs/security/logging.md`).

## Neon (restore window)

[History window](https://neon.com/docs/introduction/restore-window), [pricing](https://neon.com/pricing), [instant restore](https://neon.com/docs/guides/branch-restore).

| Plan | Default | Longest | Cost |
| --- | --- | --- | --- |
| Free | 6 hours | 6 hours, capped at 1 GB of history | None |
| Launch | 1 day | 7 days | $0.20/GB-month |
| Scale | 1 day | 30 days | $0.20/GB-month |

- **The two pages conflict on Free.** The docs give it a 6-hour history window that controls instant
  restore. The pricing page lists instant restore on Free as "Not available". **Check it in the
  console:** Postgres database → Backup & Restore → Restore from history. Don't count on Free until
  you've seen it work.
- **Six hours would miss a bad overnight migration** found in the morning, and a default of 1 day
  stays 1 day until someone changes it. The 7-day window means **Launch, with the setting raised**.
- **What a restore does:** it overwrites all data and schema on the branch and keeps a backup branch
  named `{branch_name}_old_{head_timestamp}`. It works on root branches only.

## Healthchecks.io (heartbeats)

[Pricing](https://healthchecks.io/pricing/), [API](https://healthchecks.io/docs/http_api/), [terms](https://healthchecks.io/terms/).

- **Free (Hobbyist):** 20 jobs, 100 log entries per job. Jane needs 9: 7 jobs, the probe, the backup.
- SMS, WhatsApp and phone calls are paid. Pushover is the phone push option its docs name, and they
  don't say whether it's free on Hobbyist.
- The terms say nothing on commercial use of free accounts, and don't mention a DPA. What's sent is
  only a job's name and the time, so there's no personal data to process.
- The docs don't state the period and grace of a check made automatically by `?create=1`, so set
  them by hand (`Founder only` in the notes).

## Robinhood (a person's brokerage, off unless `ROBINHOOD_LINK=1`)

[Agentic trading overview](https://robinhood.com/us/en/support/articles/agentic-trading-overview/),
[trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/),
[onboarding an external agent](https://robinhood.com/us/en/support/articles/onboarding-an-external-agent/),
[metadata](https://agent.robinhood.com/.well-known/oauth-authorization-server). Read on 2026-11-05.

- **Not in use.** The switch is off, and `/privacy` mentions it only when it's on. Whether its terms
  allow an app to connect for its users is unknown, and the founder is asking.
- **What the connection can see:** every Robinhood account, including account numbers, positions,
  balances, and transaction and order history.
- **What it can do:** trade in a separate agent account, if the person opens one. One scope,
  `internal`; no read-only one. Trade approvals are off by default for external agents.
- **Who's named:** the onboarding article lists platforms it supports and says to contact support for
  others. Whether a site's own sign-in address is accepted isn't stated.
- **Revoking:** the metadata has no revocation address, and the articles give no steps beyond
  disconnecting on the platform and contacting support.
- **Terms on data:** its disclosures have the person assume the risk of any use of their data by
  third-party AI providers. That's worth counsel's read before this is offered.

**What Jane sends** (`src/lib/robinhood/`): the tokens, and an account number in a request about that
account. It calls only the tools on the list in `mcp-client.ts`. See `docs/setup/robinhood.md`.

## Gmail (a person's mailboxes, off unless `GMAIL_LINK=1`)

[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch),
[unverified apps](https://support.google.com/cloud/answer/7454865),
[restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
[Gmail API quota](https://developers.google.com/workspace/gmail/api/reference/quota),
[revoking a token](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke),
[Workspace API user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy),
[API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).
Read on 2026-11-18, with the quotes checked word for word against the pages.

- **Not in use.** The switch is off, and `/privacy` and `/terms` mention mailboxes only when it's on.
  Setting it up, the founder's test and turning it off: `docs/setup/gmail.md`.
- **What the connection can see:** the whole mailbox. Jane asks for `gmail.readonly` alone, which
  Google lists as a restricted scope, and which `messages.get` and `messages.attachments.get`
  accept: every email, attachments included. Jane looks at the sender, subject and first lines of
  each new email, fetches a whole email only when a company wrote about money, and never fetches an
  attachment.
- **What it can do:** read, and ask Google to send word of new mail (`users.watch` accepts
  `gmail.readonly`) and to stop sending it. Jane's code makes no other call to Gmail
  (`src/lib/gmail/api.ts`), so it sends, deletes and changes nothing.
- **Google's check of the app:** until Google verifies it, Google's sign-in page warns people first,
  and the project can take "100 new users in total, after the app presents the unverified app
  screen", for its whole life. Verifying a restricted scope includes a security assessment, repeated
  "at least every 12 months". For projects made from 2026-05-01, quota is counted in units
  (`messages.get` 20, or 60 for a whole email; 6,000 a minute for one Google account), and
  "Exceeding the quota request limits is planned to incur charges to your Google Cloud billing
  account later in 2026."
- **Revoking:** when a mailbox is disconnected, removed for inactivity or deleted with the account,
  Jane posts its refresh token to Google's revoke address, unless another Jane account's active
  mailbox holds the same address. "Revocation removes all OAuth 2.0 scopes previously granted to a
  project, invalidating any issued access or refresh tokens for all clients registered under that
  project", which is why Gmail has a Google Cloud project of its own. A person can also remove Jane
  in their Google Account, and changing their Google password ends it too.
- **Terms on data, "Limited Use":** use is limited to "providing or improving your appropriate use
  case or features that are visible and prominent in the requesting application's user interface";
  data goes to another company only for that, "and only with the user's consent" (or for security,
  the law or a merger); "Do not allow humans to read user data, unless" the person consents for
  specific messages, it's for security or the law, or it's aggregated and anonymized; and never for
  ads, "to determine credit-worthiness or for lending purposes", or "to create, train, or improve a
  machine learning or artificial intelligence model beyond that specific user's personalized model".
  The Workspace policy (updated 2026-09-03) also asks for tokens "encrypted at rest", protection
  against prompt injection, and a disclosure in the app that "Cannot be placed only in a privacy
  policy or terms of service". `/privacy` carries Google's sentence while the switch is on.
- **Anthropic:** Google's pages don't address sending email text to an outside AI provider in those
  words. By their text it's a transfer: allowed for the feature people see, with their consent, and
  the provider mustn't train on it. So Anthropic's terms on training and retention need to be on
  file before switching on.

**What Jane sends** (`src/lib/gmail/`): to Google, the sign-in's code and the tokens, and requests
about that one mailbox, only to the addresses in `src/config/gmail.ts`. To Anthropic, for each email
that passes the screen and carries no code or password (`src/lib/gmail/read-mail.ts`): the day it
arrived, the sender's domain as Google checked it, and the subject and text with links, email
addresses and long numbers taken out, at most the first 2,500 and the last 1,500 characters. An email
can still hold anything its sender wrote, such as a name, a home address, part of an account number
or what was bought. Claude answers with a kind, an amount and a date, and only those, once code has
checked them, are kept.

## The hourly probe's host

GitHub Actions rather than Checkly: free on a public repository, nothing to sign up for, and the
secret stays in GitHub. If the repository goes private it uses paid minutes. GitHub also turns off
scheduled workflows after a long quiet spell in a repository, and the `jane-probe` heartbeat would
catch that.

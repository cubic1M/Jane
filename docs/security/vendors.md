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

## The hourly probe's host

GitHub Actions rather than Checkly: free on a public repository, nothing to sign up for, and the
secret stays in GitHub. If the repository goes private it uses paid minutes. GitHub also turns off
scheduled workflows after a long quiet spell in a repository, and the `jane-probe` heartbeat would
catch that.

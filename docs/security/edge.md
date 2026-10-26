# Security at the edge

Groundwork for a future SOC 2 audit (founder, 2026-10-26): what every response carries, how
requests are rate limited, and what the access log records. Each section names the code that
does it and the tests that hold it.

## In short

- **Pages only run Jane's own code.** Every page has a Content-Security-Policy with a new random
  value (a *nonce*) each time it loads. A script without that value doesn't run, so code someone
  manages to slip into a page can't run either.
- **Nobody can flood Jane.** Every API call and every button or form that changes something is
  counted per IP address and per signed-in session. Past the limit, the reply is "Too many
  requests. Please wait a moment and try again." Sample (Try Jane) people have their own, lower
  limits.
- **Every way in is written down.** Sign-ins, sign-outs, failed attempts, two-factor changes,
  bank links and unlinks, data downloads, account deletions, and every team page view and team
  action go into the audit log with the time, IP address, browser, rough place and outcome.
  Secrets never do. People see their own on `/security`; the team searches everything at
  `/admin/access-log`. Entries go after 400 days.

## Security headers

Code: `src/lib/security-headers.ts` (the values), `src/proxy.ts` (each page's policy and nonce),
`next.config.ts` (everything else). Tests: `src/lib/security-headers.test.ts`,
`e2e/security-headers.spec.ts`.

| Header | Value | Why |
| --- | --- | --- |
| Content-Security-Policy (pages) | `script-src 'self' 'nonce-…' 'strict-dynamic' https://cdn.plaid.com`, `default-src 'self'`, `frame-src 'self' https://cdn.plaid.com`, `connect-src 'self'` + Plaid's API, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`, `report-uri /api/csp-report` | Only scripts with this request's nonce run, plus what they load (`'strict-dynamic'`: Next.js's chunks and Plaid Link). No `'unsafe-inline'` or `'unsafe-eval'` for scripts in production. |
| Content-Security-Policy (API) | `default-src 'none'; frame-ancestors 'none'` | API responses are data, never pages. |
| Content-Security-Policy (`/api/documents/:id`) | `sandbox; default-src 'none'; …` | An uploaded PDF or image can't run code on our site. |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | HTTPS only, for two years. |
| X-Frame-Options / `frame-ancestors` | `DENY` / `'none'`; `/chat` is `SAMEORIGIN` / `'self'` | No other site can show Jane in a frame (clickjacking). The side chat frames our own `/chat`. |
| X-Content-Type-Options | `nosniff` | Browsers don't guess file types. |
| Referrer-Policy | `strict-origin-when-cross-origin` | Other sites see only our domain, never a path. |
| Permissions-Policy | `microphone=(self)`, and camera, location, payment, USB and the rest `()` | Speaking to Jane needs the microphone, on our own pages only. The side chat's frame has `allow="microphone"`. (Before this, `microphone=()` blocked it everywhere.) |
| Cross-Origin-Opener-Policy | `same-origin-allow-popups` | Other sites can't keep a handle on a Jane window. Popups we open (Plaid's OAuth banks) can still report back. |
| X-Permitted-Cross-Domain-Policies | `none` | Old plugin cross-domain access off. |

**Allowed from outside:** Plaid only (`cdn.plaid.com` for Link's script and frame,
`production.plaid.com` and `sandbox.plaid.com` for its calls). PostHog is called from the server
only, so the browser never needs it. Fonts are self-hosted by `next/font`, and the landing column's
image comes from our own site. Vercel's preview toolbar isn't allowed; we don't use preview
deployments.

**Blocked reports.** Browsers post anything the policy blocks to `/api/csp-report`. The route
keeps the rule and the blocked origin, drops query strings, script text and browser-extension
noise, and stores it in `/admin/errors` as `CspViolation`. If a change to the policy breaks
something live, it shows up there.

### The trade-off: no Cache Components

A nonce must be new on every request. Next.js's Cache Components (partial prerendering) serves
a page shell made at build time, and its scripts can't carry a per-request nonce, so the policy
would block them and the page wouldn't work. This was checked on a production build: with Cache
Components on, the landing page's 27 scripts had no nonce and nothing hydrated. So
`cacheComponents` is `false` and the root layout waits for the request (`connection()`). Every
page now renders per request.

- **Cost:** pages that used to come straight from Vercel's CDN (the landing page, legal pages)
  and the instant prerendered shells of signed-in pages now come from the server function.
  Locally the first byte still arrives in about 4 ms. On Vercel a cold function is slower than
  the CDN.
- **Guard:** `security-headers.test.ts` fails if `cacheComponents` is turned back on, and the
  e2e test fails if any page's script lacks the nonce.
- **The alternative** was `'unsafe-inline'` scripts with Cache Components kept, the policy Jane
  had before. It blocks scripts from other sites, but not code slipped into a page, which is
  the main thing a CSP is for.

## Rate limits

Code: `src/config/rate-limits.ts` (every number), `src/lib/rate-limit.ts` (counters in
Postgres), `src/lib/edge-limits.ts` (the proxy's checks). Tests: `src/lib/edge-limits.test.ts`,
`src/lib/rate-limit.integration.test.ts`, `e2e/rate-limits.spec.ts`.

Two layers:

1. **At the edge**, in the proxy, before any API route or server action runs. Per IP and per
   signed-in session, both counted in one database round trip:

   | What | Per IP | Per session | Sample (Try Jane) session |
   | --- | --- | --- | --- |
   | API routes (`/api/*`) | 300 / min | 300 / min | 180 / min |
   | Server actions (forms, buttons) | 120 / min | 60 / min | 30 / min |
   | Back from a sign-in link or Google (`/api/auth/callback/*`) | 30 / 10 min | | |

2. **Per feature**, in the code that does the costly or sensitive thing, mostly per person:
   sign-in emails (10 per 10 min per IP and per address), two-factor codes (5 per 10 min),
   chat messages (60 an hour, and Claude's daily and monthly spend caps), Plaid link tokens and
   exchanges (20 per 10 min), data export (5 an hour), documents, invite codes (30 an hour per
   admin), Try Jane (20 an hour per IP, and 25 Claude answers per sample person), and more. The
   full list is in `src/config/rate-limits.ts`.

- **Cron routes** (`/api/cron/*`) aren't limited: only Vercel calls them, with `CRON_SECRET`.
  A test walks every route in `src/app/api` and fails if one is neither limited nor a cron route
  that checks `CRON_SECRET`.
- **Over the limit:** status 429, a `Retry-After` header, and "Too many requests. Please wait a
  moment and try again." API callers get it as JSON. Server actions get plain text, which the
  page shows as the error.
- **Privacy:** counters are keyed by a hash of the IP or session, never the IP or token itself,
  and are deleted after a day.
- **Sample people** are recognised by their session token's `trial_` prefix, so the proxy needs
  no database read to know.
- **If the database is unreachable**, the edge check lets the request through (fail open) and
  logs it. The feature limits and every other check still stand, and Jane stays up. Vercel's
  platform DDoS protection sits in front of all of this.
- **No IP header** happens only on local runs (Vercel always sets `X-Forwarded-For` itself).
  Then the per-IP edge counter is skipped, so the end-to-end tests' browsers don't share one.

## Access log

Code: `src/config/access-log.ts` (which events), `src/lib/audit.ts` (`logAudit` adds the
details), `src/lib/request-details.ts`, `src/lib/auth-events.ts` (failed sign-ins),
`src/lib/admin-access.ts` (team views and actions), `src/lib/access-log.ts` (reading it).
Tests: `src/lib/access-log.integration.test.ts`, `src/lib/audit.test.ts`.

**What's recorded** (all in the `audit_log` table):

| Event | When |
| --- | --- |
| `user_signed_up`, `user_signed_in` | Auth.js signed someone in (email link or Google) |
| `user_signed_out` | Signing out (before the session goes, so we know whose it was) |
| `session_signed_out`, `other_sessions_signed_out` | Signing out another device, or all of them |
| `sign_in_failed` | A bad or used sign-in link, a refused or broken Google return, a forged request, no invite, a bad invite code, or too many attempts. The reason, never the address tried |
| `mfa_enabled`, `mfa_verified`, `mfa_failed`, `mfa_disabled`, `mfa_backup_code_used`, `mfa_backup_codes_created`, `admin_mfa_*` | Two-factor |
| `item_linked`, `item_relinked`, `item_removed` | A bank linked, reconnected or unlinked |
| `data_exported`, `user_data_deleted` | "Download my data", "Delete all my data" |
| `admin_page_viewed`, `admin_action` | Every team page view (not prefetches) and every team form or button, by path. Logged by the proxy |
| `admin_viewed_*`, `action_status_changed`, `user_made_admin`, `invite_code_*`, `invite_redeemed` | The named team events that already existed |

Each entry has the time (`created_at`, UTC), who (`actor_type`, `actor_id`), what it was about
(`target_type`, `target_id`), and in `metadata`: `outcome` (`success` or `failure`), `ip`,
`user_agent` (first 300 characters), and `city` and `country` from Vercel's free IP headers.

**Never secrets.** `logAudit` drops any metadata key named like a credential (token, secret,
password, authorization, cookie, API key) and scrubs tokens, keys, JWTs and database URLs out of
values, even if a caller passes one by mistake. Request details come from a fixed list of headers,
never cookies or `Authorization`. Paths are stored without their query string.
`access-log.integration.test.ts` sends cookies, bearer tokens, Plaid tokens and a sign-in link
token through every path and checks none reach the table.

**Who sees it.**
- `/security`, signed in: "Your recent activity", your last 20 sign-ins and account changes,
  with device, place and time, and a link to sign out other devices.
- `/admin/access-log` (admins with two-factor): filter by event, person (id or email), IP,
  outcome and dates, 100 entries a page. Viewing it is itself logged.

**How long.** 400 days (`RETENTION_PERIODS.accessLog` in `src/config/retention.ts`), so a yearly
audit can see its whole year. The daily cleanup (`src/lib/retention.ts`) deletes only access-log
events. Other audit entries, like Terms consent and decisions, stay. The privacy policy's retention
list and "What we collect" say so.

## Not done here

- Nothing alerts on a burst of failed sign-ins yet. The entries are there to build one on (by IP
  or by `sign_in_failed` count).
- The edge limits are fixed windows. Someone can send up to twice a limit across a window
  boundary. Fine as a backstop; the per-feature limits are the tight ones.
- Plain page views (GET) aren't counted; Vercel's platform protection covers floods.
- Row-level security in Postgres and key rotation are separate work (their own pull requests).

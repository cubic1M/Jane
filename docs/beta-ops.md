# Running the closed beta

What the founders use day to day with 10-25 invited students. Everything here is in `/admin`
(ADMIN_EMAILS with two-factor).

## Inviting a student

1. Open **/admin/invites**.
2. Uses: 1. Expires in days: 14 (or blank). Only for this email: the student's address. Note: who
   they are (only the team sees it). Leave **Email it to them now** ticked.
3. Press **Create code**. The student gets "Your invite to Jane's beta" with a Sign up button (the
   code is in the link) and the code itself; replies come to the founder who sent it.
4. The code's row then says who used it and whether they made an account ("no account yet" means
   nudge them). **Email again** resends it; **Turn off** stops the code at once (accounts already
   made stay).

A code for a group (more uses, no email) can't be emailed: use **Copy sign-up link** and send it
yourself. BETA_INVITE_ONLY must stay on (anything but "false").

## Feedback

A student taps their profile, then **Send feedback**: a few words and, if they like, a screenshot
(PNG, JPEG or WebP, under 4 MB). It's listed on **/admin/reports** and emailed to ADMIN_EMAILS at
once with the words and the page. The screenshot is never emailed: it's encrypted, opens from the
list, and each view is on the audit log and on the student's "who saw my data" page.

## Alarms (src/lib/ops-alerts.ts, src/lib/error-alerts.ts)

| What | When the founders hear |
| --- | --- |
| A server error (5xx) | At once, at most once an hour per kind and page; daily count |
| Sign-in emails not sending | At once, at most once an hour |
| A Plaid webhook failing | At once, at most once an hour |
| A Plaid webhook with a bad signature | Daily count (many means verification broke) |
| A Plaid sync failing | Daily count, with Plaid's error codes |
| A bank connection breaking (needs sign-in) | Daily count; the student sees "Sign in again" |
| A bank disconnecting in 7 days | Daily count; the student sees "Sign in again by …" |
| A daily job not running, Claude past half its month | Once per lapse (src/lib/health.ts) |

Nothing is sent on a quiet day. /admin/health shows the same counts for the last day and week.
Emails carry kinds, pages and codes only: never a person, an address or bank data.

## Costs

**/admin/costs**: Plaid banks billed this month (connected now plus removed this month, real banks
only), Claude's spend against CHAT_MONTHLY_CAP_CENTS, and active beta people this month and week.

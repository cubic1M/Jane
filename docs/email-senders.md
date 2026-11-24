# Email senders

Everything goes out through one `sendEmail` (`src/lib/email.ts`). It has two senders, chosen by env:

| `EMAIL_PROVIDER` | Sender | Needs |
| --- | --- | --- |
| empty or `resend` | Resend (the default) | `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain |
| `agentmail` | AgentMail | `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID` |

Both sit behind the same guards (a trial person's address never gets mail, the `KILL_EMAIL` switch)
and take the same headers, so the one-click unsubscribe works on either. Why there are two: in
production Resend can email only the account owner until a sending domain is verified (the founder's
setting); AgentMail sends from an address it provides.

## With no domain verified, the founder can still get the daily report himself

Resend lets an account that has verified no sending domain send only to the account owner's own
address (its error says "You can only send testing emails to your own email address"). So today the
daily report reaches the founder, and nobody else, **if the email he signs in to Jane with is the same
address as the email on his Resend account**. Anyone else's report fails to send and is given back
(the day isn't used up, and the failure is logged without the address).

How he can tell, by the names of the settings only (never copy a value into a chat or a commit):

- In Resend, the sender-domain page (Domains) shows no verified domain, and the account's own email
  is under its profile settings (Settings, then Profile).
- In Jane, the address he signs in with is the one his sign-in link arrives at.
- If those are the same address, the report reaches him. If they differ, it won't, until a domain is
  verified in Resend (and `EMAIL_FROM` is set to an address on it) or `EMAIL_PROVIDER=agentmail` is
  set up below.
- In Vercel's environment settings, `RESEND_API_KEY` and `EMAIL_FROM` must both be set for any email to
  go at all; `ADMIN_EMAILS` (the team's own alerts) has nothing to do with this.

## AgentMail, from its public docs (read 2026-11-23, nothing signed up)

- **Own domain?** No. An inbox is `<name>@agentmail.to` by default. A custom domain is optional (the
  free plan allows one).
- **Receiving replies?** Yes. Every inbox receives, with webhooks, a websocket or polling.
  `sendEmail` takes `replyTo`; nothing reads replies yet.
- **Cost.** Free: 3 inboxes, 3,000 emails a month, 100 a day, one custom domain, and a "Sent via
  AgentMail" footer. Developer: $20 a month, 10,000 a month, 1,000 a day, no footer. Startup: $200 a
  month, with a SOC 2 report. No credit card for Free.
- **Limits that matter.** After the account is verified, sending to anyone is allowed, but to new
  recipients only 3 in the first hour, 5 in the first day and 10 in the first week. An account that
  isn't verified can email only its attached human, 10 a day. Fine for a closed beta of 10 to 25,
  slow for a launch.
- **What it keeps.** Messages sit in the inbox until deleted; the 24-hour message expiry is an
  enterprise option. The privacy policy was not readable without a browser, so read it before this
  carries real people's mail. The sign-in link is a credential: it would pass through their servers.
- **Opens.** Open tracking needs a custom domain and adds a tracking pixel, and /privacy says Jane
  uses none, so it isn't used.
- **Deliverability.** The free plan sends from a shared domain and IPs; expect spam folders more
  often than from a domain of our own.

## What the founder does (we create no account)

1. Sign up at the AgentMail console (Free, no card) and create an inbox, for example
   `jane-reports@agentmail.to`.
2. Create an API key and paste it into Vercel as `AGENTMAIL_API_KEY`; set `AGENTMAIL_INBOX_ID` to the
   inbox address and `EMAIL_PROVIDER` to `agentmail`. Never in code or a log.
3. Send a test email to himself first. To go back to Resend, empty `EMAIL_PROVIDER`.

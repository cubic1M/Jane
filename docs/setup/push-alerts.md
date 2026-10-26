# Turn on phone alerts (web push)

With phone alerts on, someone can tap **Turn on** in Settings and get Jane's urgent alerts (a bill
due, a charge that may not be theirs) as notifications on that phone or computer instead of by
email. Until the three settings below exist, the Turn on button is hidden and alerts go by email,
as now. It's free: no account to sign up for. About 5 minutes.

## 1. Make the keys on your own computer

You need Node.js installed (it comes with `npx`). In a terminal, run:

```bash
npx web-push generate-vapid-keys
```

It prints two lines, a **Public Key** and a **Private Key**. Copy each one exactly. Run it once
only: if you change the keys later, everyone who turned alerts on has to turn them on again.

## 2. Add them to Vercel

In Vercel, open the Jane project, then **Settings → Environment Variables**. Add these three for
**Production**:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | the Public Key |
| `VAPID_PRIVATE_KEY` | the Private Key |
| `VAPID_SUBJECT` | `mailto:` and an email that push services can contact, for example `mailto:team@your-domain` |

They take effect on the next deploy. Every merge to main deploys by itself, or you can click
**Redeploy** on the latest deployment.

Keep the private key secret: only in Vercel. If it leaks, make new keys (step 1) and replace all
three settings; people then turn alerts on again.

## 3. Check it

- Sign in on the live site, open **Settings**, and find the phone alerts line: "Get urgent alerts
  on this device instead of by email." Tap **Turn on** and allow notifications when asked.
  - Android (Chrome) and computers (Chrome, Edge, Firefox, Safari): works in the browser.
  - iPhone and iPad: first add Jane to the Home Screen (Share, then **Add to Home Screen**),
    open it from there, then turn alerts on (iOS 16.4 or newer).
- The next urgent alert arrives as a notification, and its buttons (like Yes) answer it.
- `/admin/launch` shows **Phone alerts** as done.

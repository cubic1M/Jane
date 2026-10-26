# Turn on PostHog analytics

Jane already saves every funnel event (signing up, linking a bank, opening a card and so on) in
its own database, the `analytics_events` table. With PostHog set up, each event also goes to
PostHog, so you get funnels and charts without writing SQL. People trying Jane with sample data
are never counted, in either place. Nothing breaks while it isn't set up. PostHog's free plan
covers 1 million events a month, far more than the beta needs. About 5 minutes.

## 1. Make a PostHog project

1. Sign up at <https://posthog.com/> (free). When asked, pick **US cloud** or **EU cloud** (either
   works; remember which).
2. Name the project "Jane". You can skip the "install the snippet" steps: Jane sends events from
   its server, so there's nothing to add to the site.
3. Open **Settings → Project** (the gear icon). Copy the **Project API key**. It starts with
   `phc_`, and it's meant to be public, so it's safe in a browser, though Jane only uses it on
   the server.

## 2. Add it to Vercel

In Vercel, open the Jane project, then **Settings → Environment Variables**. Add these for
**Production**:

| Name | Value |
| --- | --- |
| `POSTHOG_KEY` | the Project API key (`phc_...`) |
| `POSTHOG_HOST` | `https://us.i.posthog.com` for US cloud, or `https://eu.i.posthog.com` for EU cloud |

They take effect on the next deploy. Every merge to main deploys by itself, or you can click
**Redeploy** on the latest deployment.

## 3. Check it

- On the live site, do something that counts: open the landing page, or sign in.
- In PostHog, open **Activity** (or **Events**): within a minute you'll see events like
  `landing_viewed` (and `signup_completed` after a sign-up), with the person's id for
  signed-in people.
- `/admin/launch` shows **Analytics** as done.

If PostHog is ever down, sign-ins and everything else still work: the event is still saved in
Jane's database and the failure is only logged.

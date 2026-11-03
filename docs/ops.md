# Running without a person in the loop

Three things sit on the live site, all off until a founder sets them up: a watch that acts, a reader
that advises, and journeys that stop a bad build before it takes traffic. The steps to turn them on
are in the founders' list, not here.

The split matters most. **The script that can act can't be argued with, and the agent that reads the
logs can't act.** Logs can hold text an attacker wrote, and the best root-cause agents score under 50%
on independent benchmarks.

| | Watch | Reader |
| --- | --- | --- |
| Code | `scripts/ops/watch.mjs`, `watch-core.mjs` | `scripts/ops/reader.mjs`, `reader-core.mjs` |
| Runs | Every 10 minutes (`watch.yml`) | When the watch fires (`incident-reader.yml`) |
| Model | None | Yes, one call per incident |
| Reads | Yes or no, and counts | Scrubbed errors, jobs and switches (`/api/ops/evidence`) |
| Can do | Roll back code, freeze deploys, set a switch, page a phone | Send a phone one short guess |
| Holds | The Vercel token, the switch secrets | A read-only secret and its own model key |

No agent session holds a Vercel token or the production `DATABASE_URL`. Neither of these touches a
database directly, and a restore stays a person's decision, because it overwrites data and can bring
back what someone asked to delete.

## What the watch does

Each trigger is confirmed first: the health check three times, a minute apart, and the probe twice.

| It sees | It does |
| --- | --- |
| A cross-user check failed | `KILL_BANKS` and `KILL_UPLOADS`, roll back however old the deploy is, freeze, page |
| The same again within 6 hours of a rollback | The last good code leaks too: `KILL_SITE`, freeze, page |
| Health check down, deploy under 2 hours old | Roll back, freeze, page |
| A sign-in or page check failed, deploy under 2 hours old | Roll back, freeze, page |
| A job that worked before failed since this deploy, under 26 hours old | Roll back, freeze, page |
| Any of those down or failed with an older deploy | Page only: code didn't do it |
| The site was stopped on purpose | Nothing |

- **Rollbacks:** at most one successful one in 6 hours, code only. A migration stays in place
  (`docs/migrations.md`), so migrations must stay additive.
- **Pages:** at most one an hour for the same thing, unless the watch also did something.
- **`KILL_SITE`** needs a leak that survived a rollback, because it also stops webhooks. **`KILL_EMAIL`**
  has no trigger at all, because it stops sign-in links. Only a person sets it.
- **Everything goes on the record:** each action on the `ops-numbers` branch (`actions.jsonl`, short
  codes only because the repo is public), and each switch change in `audit_log`.

## Switches in seconds

With `OPS_SWITCHES=1`, each switch in `docs/incident.md` can also be set from a store, with no deploy.
A request reads it at most every 5 seconds, and waits at most 800ms. A failed read keeps what it last
knew. A store switch also survives a rollback, which an environment variable can't be relied on to do.

```bash
curl -X POST "$SITE/api/ops/switches" -H "authorization: Bearer $OPS_FOUNDER_SECRET" -H 'content-type: application/json' -d '{"switch":"banks","on":false,"trigger":"founder"}'
```

| Secret | May |
| --- | --- |
| `OPS_REDUCE_SECRET` | Turn on `banks`, `uploads`, `claude` |
| `OPS_HIGH_BAR_SECRET` | Those, and `site`, `email` |
| `OPS_FOUNDER_SECRET` | Turn anything on or off. Only this turns anything back on |

A stop from the store spares `/api/ops/*`, so it can be turned off again. `KILL_SITE=1` in Vercel spares
nothing. **A build older than this code doesn't read the store,** so rolling back past it loses the
store's switches.

## Before a deploy takes traffic

`node scripts/ops/journeys.mjs <url> [commit]` checks the app, the commit, the database, that the
landing page's scripts can run, and the probe. The probe runs on the candidate's code: sign-in, the
dashboard, one person not reading another, tokens, and the guardrail. Then, in a browser:

```bash
CANDIDATE_URL=<url> npx playwright test --config playwright.candidate.config.ts
```

Where it goes in a deploy: `vercel deploy --prod --skip-domain` makes a candidate with no traffic, these
two run against its URL, and `vercel promote <url>` happens only if both pass. The build still runs
`prisma migrate deploy` before any of this, so a stopped candidate can leave a migration behind.

## After a rollback

Vercel stops assigning new deploys to production until the rollback is undone, and the watch opens an
issue labelled `deploy-freeze`. A person checks production, then:

1. `vercel promote <deployment>`, which undoes the rollback.
2. Close the issue. A deploy loop checks it with `node scripts/ops/frozen.mjs && continue`.
3. Clear any switches with the founder secret.

## The numbers page

`scripts/ops/numbers.mjs` writes [the page](https://github.com/cubic1M/Jane/blob/ops-numbers/numbers.md)
daily from GitHub and git. There are no thresholds until the four-week baseline ends on 2026-12-01.

## Drills

`scripts/ops/drill.mjs` times all of this on a local production build with stand-ins for Vercel and a
phone, on a scratch database. It proves the logic and the timing here, not Vercel's behaviour.

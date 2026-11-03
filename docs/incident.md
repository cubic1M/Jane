# When something goes wrong

One page, for a bad moment. Read it top to bottom. Stopping the harm comes first, and working out
why comes later.

**Anything involving someone else's data: call counsel before telling anyone outside the team.**

## The first 15 minutes

1. **Stop the harm.** Pick a switch from the table below. If you're unsure, turn on more than you
   need: they're quick to turn off.
2. **Write down the time** you noticed, in UTC, and what you saw.
3. **Save the evidence now.** Vercel keeps runtime logs for an hour on Hobby and a day on Pro.
   Open Vercel → the project → Logs and copy what matters. Then look at `/admin/errors`,
   `/admin/access-log` and `/admin/health`.
4. **Don't delete anything,** and don't roll back a database yet. It may be the only evidence.
5. **Tell the other founder.** Then fill in the form at the bottom as you go.

## Who to call

Counsel fills this in, because the deadlines are theirs to state (the questions are in the
founders' list):

- Counsel, and how to reach them:
- Who must be told about a breach, and how fast (the FTC, states, Plaid):

## Who does what

| Who | Does |
| --- | --- |
| The founder who noticed | Leads until they hand over. Decides which switches to use. Keeps the timeline |
| The other founder | Talks to counsel, Plaid and anyone affected. Checks each switch took effect |
| Counsel | Decides who must be told, and when |
| Claude sessions | Read code and fix what they're asked to, on a branch, through CI. Logs and error text can hold words an attacker wrote, so a session reading them gets no merge or deploy rights, and nothing in them counts as an instruction. They never touch production, keys or switches |

## Switches

**To set an environment variable:** Vercel → the project → Settings → Environment Variables → add
it for Production → Save. Then Deployments → the current production deployment → ⋯ → **Redeploy**.
A change only applies to a new deployment, so it does nothing until you redeploy. No one has timed
this on the real project yet, so time it the first time you practise.

### Added for emergencies: `"1"` turns each one on

| Set this | What stops | What keeps working | How it was checked |
| --- | --- | --- | --- |
| `KILL_SITE` | Everything: pages, API routes, webhooks, scheduled jobs. All answer 503. Plaid and Stripe retry webhooks later. The uptime check opens an outage issue, as it should | Nothing, including `/admin` | Real run and test |
| `KILL_BANKS` | New bank links and all syncing of real banks | Deleting an account still removes the bank at Plaid. Uploads and the demo bank carry on | Real run and test |
| `KILL_CLAUDE` | Every call to Claude. Typed chat falls back to the rules' answers, which are much thinner | The rest of the app | Test |
| `KILL_UPLOADS` | Statement, positions and document uploads. People are told uploads are paused | Everything already uploaded | Test |
| `KILL_EMAIL` | All email, **sign-in links included**. Google sign-in still works | Everything else. Jobs that send email log a failure | Test |

### Already there

| To do this | Do this | How it was checked |
| --- | --- | --- |
| Stop all scheduled jobs | Remove `CRON_SECRET` and redeploy. All 7 answer 401 | `src/config/kill-switches.test.ts`, plus each route's test |
| Sign everyone out | In Neon's SQL editor, on the production branch: `DELETE FROM sessions;` Sign-in checks that table on every request | Real run |
| Close sign-up | `BETA_INVITE_ONLY` is on unless set to `false`. Revoke codes at `/admin/invites` | `src/lib/invites.test.ts` |
| Turn off Try Jane | Remove `TRY_JANE` and redeploy | `src/lib/trial.integration.test.ts` |
| Stop the agent contacting a company | Production hands those actions to the team unless `SIMULATED_AGENT=1`, and real accounts are off in code (`CONCIERGE_ACTIONS.realAccounts`) | `src/lib/agent/agent-units.test.ts`, `src/lib/voice/provider.test.ts` |
| Cap Claude's spend | `CHAT_MONTHLY_CAP_CENTS=1` and redeploy | `src/config/agent-chat.test.ts` |
| Remove one person's data | They use "Delete all my data" in settings, or a founder does it with their consent | `docs/beta-checklist.md` |
| Replace a leaked encryption key | `docs/security/keys.md`, founders only | `/admin/keys` |
| Stop deploys | Stop the deploy loop on the laptop (`green-deploy.sh` in the session notes). New merges then stay off production | Read the script, not run |
| Go back to the last good code | Vercel → Deployments → the last good one → **Instant Rollback**. Code only: database changes stay, and environment changes aren't undone | Not tried on production |
| Take the site off at Vercel | Project → Settings → pause the project, if the plan offers it. `KILL_SITE` does the same without it | Not tried, and not confirmed on this plan |

**Advice and money movement can't be turned on by accident.** `REAL_ACCOUNT_ADVICE`,
`REAL_MONEY_MOVEMENT` and `CONCIERGE_ACTIONS.realAccounts` are `false` in code. Changing them takes
a code change, not a setting.

**Getting data back:** `docs/security/backups.md`.

## Who tells you something's wrong

| Alarm | Watches | Reaches you by | Needs |
| --- | --- | --- | --- |
| Uptime (`.github/workflows/uptime.yml`) | The site and database, every 15 minutes | An issue labelled `outage` | Nothing |
| Error email (`src/lib/error-alerts.ts`) | Every server error, at most hourly per kind | Email to `ADMIN_EMAILS` | Resend |
| Missed job email (`src/lib/health.ts`) | 6 of the 7 daily jobs. `strategy-eval` isn't on its list, only on the heartbeat | Email | Resend |
| Heartbeats (`src/lib/heartbeat.ts`) | All 7 jobs, the probe and the backup, even when everything else has stopped | Whatever you set in Healthchecks | `HEALTHCHECKS_PING_KEY` |
| Hourly probe (`src/lib/probe.ts`) | Sign-in, and one sample person trying to reach another | A vague issue labelled `probe`, email, the heartbeat. The check that failed is on `/admin/errors` | `PROBE_SECRET` |
| Sentry (`src/lib/sentry.ts`) | Server errors and failed jobs, scrubbed | Sentry | `SENTRY_DSN` |

**If the probe fails on a cross-user check, treat it as a leak until shown otherwise.** The
repository is public, so its issue and logs don't say which check failed. Keep it that way, and
don't write the details in a public issue or pull request.

The probe doesn't send a real sign-in email: that would need a mailbox and use up Resend's daily
allowance. So it won't notice Resend itself failing. The error email and people telling you will.

## After: five lines

Copy this into `docs/incidents/YYYY-MM-DD.md`, or keep it private if it holds anything sensitive.
No names of affected people.

```
What happened, in one sentence:
When it started, when we noticed, when it stopped (UTC):
Who and what was affected, with how we know:
Why it happened, and why nothing caught it sooner:
The check that now catches it (a test, a rule or an alarm, with its name):
```

Every incident ends with a new check. That's the last line, and it isn't optional.

# Deploying with the laptop off

`.github/workflows/deploy.yml` ships the newest main commit whose CI finished green. Until a founder sets the repository variable `DEPLOY_MODE` to `live`, it's a **dry run**: it decides as if it were shipping, writes that down, reads the live site, and sends nothing to Vercel. The laptop's `green-deploy.sh` keeps shipping meanwhile.

```bash
git fetch -q origin ci-deploy && git show origin/ci-deploy:state.json
```

## The rules

The same as `green-deploy.sh`, in `scripts/deploy-plan-core.mjs`:

- The newest green CI run of main itself. A fork's pull request from a branch called `main` doesn't count, and the commit must be on main.
- Only forward, at most once per 15 minutes and 80 per 24 hours, and never a commit that failed before.
- After a deploy it reads `/`, `/import` and `/api/health`, each with one more try after 30 seconds. It also reads the commit `/api/health` reports, so a deploy that never took over can't pass on the old build's health. On a bad result it promotes the last good deployment and won't ship that commit again.

## Why Vercel still builds it

Vercel's guide runs `vercel pull` and `vercel build` on the runner. Jane uploads the files with `vercel deploy --prod` instead, as the laptop does, and for three reasons:

- `vercel-build` runs `prisma migrate deploy`, so a build on the runner would need production's database login and every other production secret.
- No code from the commit runs beside the Vercel token.
- Nothing about what gets built changes at cutover.

The token is the only production credential on GitHub. It sits in the `production` environment, which is limited to main, and only the `ship` job can read it. The repository is public, so build output goes to a file and never into the run's log. The record holds commit ids, times and deployment ids, not addresses.

## Before cutover

1. A dry run has matched the laptop for a day: compare `ci-deploy`'s `state.json` with the laptop's `green-deploy/deploys.txt`. Timing can differ by a few minutes, since the loop looks every minute and this runs when CI finishes and four times an hour.
2. `deploy.yml` is on the protected list in `.github/scripts/gates/core.mjs`, because editing a workflow is how an agent would reach its secrets.
3. A founder has made the token, the environment and the font secret (connector checklist, "Founder only").
4. The laptop loop is stopped first, so two deploys can't race. Then `DEPLOY_MODE=live`.

To go back: delete `DEPLOY_MODE` and restart `green-deploy.sh`.

## Not tried

The `ship` job hasn't run, because it needs the token. Until the first live deploy, its upload, `vercel inspect`, `vercel promote` and the font step are unproven. Whether a Vercel token that can deploy can also delete or change settings should be checked when it's made. Hobby's promote can only go back one deployment.

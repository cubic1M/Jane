// The branches scripts keep records on (ci-loop, ci-flakes, ci-deploy, ops-numbers,
// claude/task-claims) hold no app, yet Vercel's Git integration builds every push to them unless the
// branch's own tree turns that off: it reads vercel.json from the commit it builds, never main's.
// Each such build fails ("Couldn't find any `pages` or `app` directory"), costs a build and counts
// toward the account's daily deployment limit. ci-flakes stopped building once its tree had this file.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const NO_DEPLOY = {
  "vercel.json": `${JSON.stringify({ git: { deploymentEnabled: false } }, null, 1)}\n`,
};

// Writes the files into a record branch's tree and returns their names, for `git add`.
export function writeNoDeploy(dir) {
  for (const [name, text] of Object.entries(NO_DEPLOY)) writeFileSync(join(dir, name), text);
  return Object.keys(NO_DEPLOY);
}

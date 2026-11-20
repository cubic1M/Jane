// Run before pushing a change to a page: npm run e2e:touched. Lists every end-to-end spec the
// changes against origin/main (or the ref given) could break, and why (./e2e-touched-core.mjs),
// then runs them at 2 workers against a production build, as CI does. A PR runs only the @critical
// specs, so a page change that breaks another spec reddens main instead (#2161, #2166, 11-20).
//   npm run e2e:touched                 build, then run what it chose (E2E_DATABASE_URL: a scratch database)
//   npm run e2e:touched -- --list       only say which and why
//   npm run e2e:touched -- --no-build   use the build already in .next
// Exits 1 when a chosen spec fails, or when there's no scratch database to run them on.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PASS_FILE, touchedSpecs } from "./e2e-touched-core.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const mergeBase = git("merge-base", base, "HEAD").trim();
// Against the working tree, so what isn't committed yet counts too.
const changedPaths = [
  ...new Set([
    ...git("diff", "--name-only", mergeBase).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").split("\n"),
  ]),
].filter(Boolean);
const diff = git("diff", "--unified=0", mergeBase, "--", "src");
const specs = readdirSync("e2e", { recursive: true })
  .filter((f) => String(f).endsWith(".ts"))
  .map((f) => ({
    file: join("e2e", String(f)),
    text: readFileSync(join("e2e", String(f)), "utf8"),
  }));

// A pass is kept for the commit it ran on: .claude/hooks/deny.mjs lets a push of a page change
// through only after one (this worktree's own git dir, so lanes don't share it).
const passed = () => {
  if (args.includes("--list")) return;
  const file = git("rev-parse", "--git-path", PASS_FILE).trim();
  writeFileSync(file, `${git("rev-parse", "HEAD").trim()}\n`);
};

const chosen = touchedSpecs({ changedPaths, diff, specs });
if (chosen.length === 0) {
  console.log(
    "No end-to-end spec opens a page these changes render or expects words they removed.",
  );
  passed();
  process.exit(0);
}
console.log(`${chosen.length} end-to-end spec(s) to run:`);
for (const { file, why } of chosen) console.log(`  ${file}\n    ${why.join("\n    ")}`);
if (args.includes("--list")) process.exit(0);

if (!process.env.E2E_DATABASE_URL) {
  console.log(
    "\nE2E_DATABASE_URL isn't set: point it at a scratch database (e2e/db.ts) and run again.",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  TRY_JANE: "1",
  DEMO_BANK: "1",
  DEMO_ADVICE: "1",
  SIMULATED_AGENT: "1",
};
if (!args.includes("--no-build")) {
  const built = spawnSync("npx", ["next", "build"], { stdio: "inherit", env });
  if (built.status !== 0) process.exit(built.status ?? 1);
}
// Two workers: above that, the per-IP rate limits look like unrelated failures (memory, 11-02). The
// phone specs skip on a computer, so they run on the phone project, as CI runs them.
const phone = (f) => /^e2e\/(?:phone-[^/]*|mobile-pass)\.spec\.ts$/.test(f);
let failed = 0;
for (const [project, files] of [
  ["chromium", chosen.map((c) => c.file).filter((f) => !phone(f))],
  ["mobile", chosen.map((c) => c.file).filter(phone)],
]) {
  if (files.length === 0) continue;
  const run = spawnSync(
    "npx",
    ["playwright", "test", "--workers=2", `--project=${project}`, ...files],
    {
      stdio: "inherit",
      env: { ...env, E2E_PROD: "1" },
    },
  );
  if (run.status !== 0) failed = run.status ?? 1;
}
if (failed === 0) passed();
process.exit(failed);

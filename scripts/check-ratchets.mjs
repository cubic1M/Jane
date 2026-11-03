// Limits that only tighten (npm run check:rules): strict array indexing in the folders that have
// been cleaned, and dead code. Prints counts and file names only.
import { spawnSync } from "node:child_process";

// noUncheckedIndexedAccess holds here, with no errors. A cleaned folder is added to this list and
// stays clean; the project as a whole isn't ready for the flag (over 2,000 errors in other folders).
const STRICT_INDEXING_FOLDERS = ["src/detection/"];

// Unused exports and exported types: too many to clear at once, and a count over a limit shouldn't
// redden main for one helper, so the limit sits a little above today's. Lower it as they go.
const DEAD_EXPORT_LIMITS = { exports: 450, types: 250 };
// What's never allowed: a whole file nothing uses, a dependency nothing uses, an import of a
// package that isn't listed.
const DEAD_NONE = ["files", "dependencies", "devDependencies", "unlisted", "binaries"];

const run = (command, args) => spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 28 });
const failures = [];

function strictIndexing() {
  const { stdout } = run("npx", ["tsc", "--noEmit", "-p", "tsconfig.ratchet.json"]);
  const errors = stdout
    .split("\n")
    .filter((l) => l.includes("error TS") && STRICT_INDEXING_FOLDERS.some((f) => l.startsWith(f)));
  for (const line of errors) console.log(line);
  console.log(`strict indexing: ${errors.length} errors in ${STRICT_INDEXING_FOLDERS.join(", ")}`);
  if (errors.length > 0) failures.push("strict indexing");
}

function deadCode() {
  const { stdout } = run("npx", ["knip", "--reporter", "json", "--no-exit-code"]);
  const { issues } = JSON.parse(stdout);
  const count = (kind) => issues.reduce((sum, i) => sum + (i[kind]?.length ?? 0), 0);
  for (const kind of DEAD_NONE) {
    for (const issue of issues) {
      for (const item of issue[kind] ?? []) {
        console.log(
          `dead ${kind}: ${kind === "files" ? issue.file : `${item.name} (${issue.file})`}`,
        );
      }
    }
    if (count(kind) > 0) failures.push(`dead ${kind}`);
  }
  for (const [kind, limit] of Object.entries(DEAD_EXPORT_LIMITS)) {
    console.log(`dead ${kind}: ${count(kind)} of at most ${limit}`);
    if (count(kind) > limit) failures.push(`dead ${kind} over ${limit}`);
  }
}

strictIndexing();
deadCode();
if (failures.length > 0) {
  console.error(`Failed: ${failures.join(", ")}`);
  process.exit(1);
}

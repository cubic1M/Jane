// How much a pull request needs before it merges, decided by what it changes and never by an agent's
// judgement (docs/gates.md). A PR takes the highest tier of any file it touches.
//   A: one fresh review. B: two reviews from different model families, plus the access proof and the
//   scanners. C: held for a founder; nothing else waits on it.
import { unsafeWords } from "../../../scripts/migration-gate-core.mjs";
import { isProtectedPath, isWatchedPath } from "./core.mjs";

// Matched in lower case, like the protected paths.
const TIER_C_PATHS = [
  /^\.github(\/|$)/,
  /^src\/config\/(advice|money-movement|concierge)\.ts$/,
  /^src\/app\/(terms|privacy)(\/|$)/,
  /^src\/lib\/terms(\.|$)/,
  /^src\/components\/terms-tick\./,
];

const TIER_B_PATHS = [
  /^src\/auth\./,
  /^src\/proxy\./,
  /^src\/lib\/auth-/,
  /^src\/lib\/crypto(\.|\/)/,
  /^src\/lib\/db(-scoped)?\./,
  /^src\/lib\/plaid(\/|$)/,
  /^src\/data-sources\/plaid(\/|$)/,
  /^src\/app\/api\/plaid(\/|$)/,
  /^prisma\/schema\.prisma$/,
  /^prisma\/migrations(\/|$)/,
];

const MIGRATION = /^prisma\/migrations\/[^/]+\/migration\.sql$/;
// unsafeWords covers drops, deletes and renames. A rewrite of existing rows is just as hard to undo.
const REWRITES_ROWS = /\bUPDATE\s+[^;]*?\bSET\b/i;

function tierOfFile(change, sqlOf) {
  const path = change.file.toLowerCase();
  if (isProtectedPath(change.file)) return { tier: "C", why: "a gate or an agent's limit" };
  if (TIER_C_PATHS.some((rule) => rule.test(path))) {
    return { tier: "C", why: "workflows, advice or money flags, or legal text" };
  }
  if (path.startsWith("prisma/migrations/")) {
    // A migration already applied somewhere must not change, and only an added one can be additive.
    if (change.status !== "A") return { tier: "C", why: "changes a migration that already exists" };
    if (MIGRATION.test(change.file)) {
      const sql = sqlOf(change.file);
      if (sql === null) return { tier: "C", why: "a migration that couldn't be read" };
      const unsafe = unsafeWords(sql);
      if (REWRITES_ROWS.test(sql)) unsafe.push("rewrites rows");
      if (unsafe.length) return { tier: "C", why: `a migration that: ${unsafe.join(", ")}` };
    }
    return { tier: "B", why: "an additive migration" };
  }
  if (isWatchedPath(change.file) || TIER_B_PATHS.some((rule) => rule.test(path))) {
    return { tier: "B", why: "auth, the database doors, Plaid, guardrails or a sensitive file" };
  }
  return { tier: "A", why: "everything else" };
}

/** `changes` from parseNameStatus; `sqlOf` reads a file as the PR has it, or null. */
export function tierOfChanges(changes, sqlOf) {
  const files = changes.map((change) => ({ file: change.file, ...tierOfFile(change, sqlOf) }));
  // A file moved out of a held path still changes that path.
  for (const change of changes) {
    if (change.from) {
      files.push({ file: change.from, ...tierOfFile({ ...change, file: change.from }, sqlOf) });
    }
  }
  const has = (tier) => files.some((f) => f.tier === tier);
  const tier = has("C") ? "C" : has("B") ? "B" : "A";
  return { tier, files: files.filter((f) => f.tier === tier) };
}

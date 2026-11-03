// What may land as a new migration (docs/migrations.md). vercel-build applies migrations before the
// new code goes live and while the old code still serves, so a migration the old code can't live
// with breaks production whatever CI says about the new code. Pure.

export const HEAD_FILE = "prisma/migrations-head.txt";
const MIGRATIONS = "prisma/migrations/";
const NAME = /^\d{14}_[a-z0-9_]+$/;

// Lifts the unsafe-SQL rules for one file, never the order rules. Must name a PR: the one that
// made the old shape unused, already live.
export const REVIEW_MARK = /^--\s*reviewed-contract-step:.*#\d+/m;

// What the old code can't live with. Squawk's other rules are about locks and style; they flag
// every new table here, and our tables are small.
export const UNSAFE_SQUAWK_RULES = new Set([
  "adding-not-nullable-field",
  "adding-required-field",
  "adding-serial-primary-key-field",
  "ban-drop-column",
  "ban-drop-constraint",
  "ban-drop-database",
  "ban-drop-default",
  "ban-drop-not-null",
  "ban-drop-table",
  "ban-drop-type",
  "ban-truncate-cascade",
  "changing-column-type",
  "renaming-column",
  "renaming-object",
  "renaming-table",
  "syntax-error",
]);

// Squawk doesn't flag these: plain deletes, or anything inside a DO block's body.
const UNSAFE_WORDS = [
  { rule: "truncate", pattern: /\bTRUNCATE\b/i },
  { rule: "delete-rows", pattern: /\bDELETE\s+FROM\b/i },
  { rule: "drop-in-block", pattern: /\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i },
  { rule: "rename-in-block", pattern: /\bRENAME\s+(?:TO|COLUMN|VALUE)\b/i },
];

const withoutComments = (sql) => sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

export function unsafeWords(sql) {
  const text = withoutComments(sql);
  return UNSAFE_WORDS.filter(({ pattern }) => pattern.test(text)).map(({ rule }) => rule);
}

// `git diff --name-status` lines under prisma/migrations/ -> what happened to which migration.
export function migrationChanges(nameStatus) {
  const added = new Set();
  const altered = new Set();
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const [status, path] = line.split("\t");
    if (!path?.startsWith(MIGRATIONS)) continue;
    const parts = path.slice(MIGRATIONS.length).split("/");
    if (parts.length < 2) continue;
    if (status === "A" && parts[1] === "migration.sql") added.add(parts[0]);
    else altered.add(parts[0]);
  }
  return { added: [...added].sort(), altered: [...altered].filter((n) => !added.has(n)).sort() };
}

// Each input is plain data, so every rule can be tried without git or Squawk:
// baseNames/headNames: the migration folders before and after; added/altered: migrationChanges();
// headFile: the text of HEAD_FILE; sqlOf(name): a new migration's SQL; findings: Squawk's JSON.
export function migrationProblems({
  baseNames,
  headNames,
  added,
  altered,
  headFile,
  sqlOf,
  findings,
}) {
  const problems = [];
  for (const name of altered) {
    problems.push(
      `${name}: an applied migration was changed or removed. Production won't run it again, so a ` +
        `fresh database and production would differ. Add a new migration instead.`,
    );
  }

  const newest = baseNames.reduce((a, b) => (a > b ? a : b), "");
  for (const name of added) {
    if (!NAME.test(name)) {
      problems.push(`${name}: a migration's name is 14 digits, then _lower_case_words.`);
    }
    if (name <= newest) {
      problems.push(
        `${name}: sorts before ${newest}, which may already be applied. Prisma would run it ` +
          `there last and on a fresh database earlier. Rename it to sort last, for example ` +
          `${nextName(newest, name)}.`,
      );
    }
  }

  const last = headNames.reduce((a, b) => (a > b ? a : b), "");
  if ((headFile ?? "").trim() !== last) {
    problems.push(
      `${HEAD_FILE} must hold the newest migration's name, ${last}. Two PRs adding migrations ` +
        `then conflict on that line, so the second rebases and is checked against the first.`,
    );
  }

  for (const name of added) {
    const sql = sqlOf(name);
    if (REVIEW_MARK.test(sql)) continue;
    const file = `${MIGRATIONS}${name}/migration.sql`;
    const unsafe = findings
      .filter((f) => f.file === file && UNSAFE_SQUAWK_RULES.has(f.rule_name))
      .map((f) => `${f.rule_name} (line ${f.line + 1})`);
    unsafe.push(...unsafeWords(sql));
    if (unsafe.length > 0) {
      problems.push(
        `${name}: the code running now can't live with this: ${[...new Set(unsafe)].join(", ")}. ` +
          `Split it into expand, then contract (docs/migrations.md). If this is the reviewed ` +
          `contract step, add a line to the file: ` +
          `-- reviewed-contract-step: <what goes>, unused since #<PR that's already live>`,
      );
    }
  }
  return problems;
}

// The first day after `newest`, keeping the new migration's words. Names are sort keys, not dates.
function nextName(newest, name) {
  const words = name.replace(/^\d*_?/, "") || "your_words";
  const stamp = newest.slice(0, 14);
  const next = new Date(
    Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8) + 1),
  );
  return `${next.toISOString().slice(0, 10).replaceAll("-", "")}000000_${words}`;
}

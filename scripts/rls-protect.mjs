// Brings every table's row-level security in line with the rule (docs/security/rls.md), after
// `prisma migrate deploy`: a table a later migration made gets its policy before the code that
// uses it goes live. Each deploy runs it (package.json vercel-build), and so does CI.
// Usage: node scripts/rls-protect.mjs [database url]  (default: DIRECT_URL, else DATABASE_URL)
import pg from "pg";

const url = process.argv[2] || process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Pass the database's URL, or set DIRECT_URL.");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // A table busy at deploy time is skipped (it waits at most 3s for its lock) and tried again.
  for (let attempt = 1; ; attempt++) {
    const { rows } = await client.query("SELECT * FROM jane_rls_protect_all()");
    const { protected: done, skipped } = rows[0];
    if (skipped.includes("(no jane_rls role)")) {
      console.warn("Row-level security is off: the database has no jane_rls role.");
      break;
    }
    if (skipped.length === 0) {
      console.log(`Row-level security: ${done} tables in line.`);
      break;
    }
    if (attempt === 5) throw new Error(`Row-level security: still busy: ${skipped.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} finally {
  await client.end();
}

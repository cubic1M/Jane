// CI's throwaway test database doesn't need to survive a crash: no waiting for each commit to
// reach the disk (fsync, synchronous_commit, full_page_writes off), which speeds up every write
// the integration and end-to-end tests make. Never for a database whose data matters.
// Usage: node scripts/fast-test-postgres.mjs <database url>
import pg from "pg";

const url = process.argv[2];
if (!url) throw new Error("Pass the test database's URL.");
const client = new pg.Client({ connectionString: url });
await client.connect();
for (const setting of ["fsync", "synchronous_commit", "full_page_writes"])
  await client.query(`ALTER SYSTEM SET ${setting} = off`);
await client.query("SELECT pg_reload_conf()");
await client.end();
// A new connection reads the reloaded settings.
await new Promise((resolve) => setTimeout(resolve, 500));
const check = new pg.Client({ connectionString: url });
await check.connect();
const { rows } = await check.query(
  "SELECT name, setting FROM pg_settings WHERE name IN ('fsync', 'synchronous_commit', 'full_page_writes')",
);
await check.end();
console.log(rows.map((r) => `${r.name}=${r.setting}`).join(", "));
if (rows.some((r) => r.setting !== "off")) throw new Error("The settings didn't take.");

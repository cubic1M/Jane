// Makes the jane_app login (docs/security/rls.md) on a scratch database, for end-to-end runs: a
// role that may use no table itself, and may switch to jane_rls or jane_system. Local databases
// only; production's is made by hand, with its own password. Usage: node scripts/ensure-app-login.mjs <owner's url>
import pg from "pg";

const ownerUrl = process.argv[2];
const url = new URL(ownerUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("This is for local databases only.");
}
const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'jane_app'");
  if (rows.length === 0) {
    await client.query(
      "CREATE ROLE jane_app LOGIN NOINHERIT NOBYPASSRLS PASSWORD 'jane_app_local_only'",
    );
  }
  await client.query("SELECT * FROM jane_rls_protect_all()");
} finally {
  await client.end();
}

import pg from "pg";

// The jane_app login (docs/security/rls.md) on a local test database: no table of its own, and
// able to become jane_rls or jane_system. Given the owner's URL, returns jane_app's.
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PASSWORD = "jane_app_local_only";

export async function ensureAppLogin(ownerUrl: string): Promise<string> {
  const url = new URL(ownerUrl);
  if (!LOCAL.has(url.hostname)) throw new Error("The jane_app test login is for local databases");
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows: doors } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'jane_system'",
    );
    if (doors.length === 0) {
      throw new Error(`No jane_system role: run prisma migrate deploy on ${url.pathname.slice(1)}`);
    }
    const { rows } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'jane_app'");
    if (rows.length === 0) {
      await client
        .query(`CREATE ROLE jane_app LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${PASSWORD}'`)
        // Test files starting together: one of them made it first.
        .catch((error: { code?: string }) => {
          if (error.code !== "23505" && error.code !== "42710") throw error;
        });
    }
    await client.query("SELECT * FROM jane_rls_protect_all()");
  } finally {
    await client.end();
  }
  url.username = "jane_app";
  url.password = PASSWORD;
  return url.toString();
}

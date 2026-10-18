import { Client } from "pg";

// Signed-in end-to-end tests write to a database, so they only run when
// E2E_DATABASE_URL points at a scratch one. Never the live database.
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;

if (E2E_DATABASE_URL && /neon\.tech/.test(E2E_DATABASE_URL)) {
  throw new Error("E2E_DATABASE_URL looks like a hosted database; use a scratch one.");
}

// Creates an admin (so CSV import is open to them) with a database session, and returns
// the session cookie value.
export async function signedInUser(): Promise<{ userId: string; sessionToken: string }> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const userId = `e2e${id}`;
  const sessionToken = `e2e-session-${id}`;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, role, updated_at) VALUES ($1, $2, 'admin', now())`,
      [userId, `${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO sessions (id, session_token, user_id, expires)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [`s${id}`, sessionToken, userId],
    );
  } finally {
    await client.end();
  }
  return { userId, sessionToken };
}

export async function deleteUser(userId: string): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
  } finally {
    await client.end();
  }
}

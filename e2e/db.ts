import { Client } from "pg";
import { TERMS_VERSION } from "../src/config/legal";

// Signed-in end-to-end tests write to a database, so they only run when
// E2E_DATABASE_URL points at a scratch one. Never the live database.
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;

// The dev server's AUTH_SECRET in signed-in tests, so tests can sign unsubscribe links.
export const E2E_AUTH_SECRET = process.env.AUTH_SECRET ?? "e2e-only-auth-secret-not-for-production";

if (E2E_DATABASE_URL && /neon\.tech/.test(E2E_DATABASE_URL)) {
  throw new Error("E2E_DATABASE_URL looks like a hosted database; use a scratch one.");
}

// Creates a user with a database session and returns the session cookie value. Admins
// by default, so CSV import is open to them.
export async function signedInUser(
  role: "admin" | "user" = "admin",
  {
    mfa = true,
    termsVersion = TERMS_VERSION,
  }: { mfa?: boolean; termsVersion?: string | null } = {},
): Promise<{ userId: string; sessionToken: string }> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const userId = `e2e${id}`;
  const sessionToken = `e2e-session-${id}`;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, role, terms_version, terms_accepted_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())`,
      [userId, `${userId}@example.test`, role, termsVersion],
    );
    await client.query(
      // Admins get a session that has already passed two-factor; e2e/mfa.spec.ts covers
      // the check itself.
      `INSERT INTO sessions (id, session_token, user_id, expires, mfa_verified_at)
       VALUES ($1, $2, $3, now() + interval '1 day', CASE WHEN $4 THEN now() END)`,
      [`s${id}`, sessionToken, userId, role === "admin" && mfa],
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

export async function digestEnabled(userId: string): Promise<boolean> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT digest_enabled FROM users WHERE id = $1`, [userId]);
    return rows[0]?.digest_enabled;
  } finally {
    await client.end();
  }
}

export async function userExists(userId: string): Promise<boolean> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    return rows.length > 0;
  } finally {
    await client.end();
  }
}

// Pushes a person's checking balance down (cents), so the forecast dips under its cushion.
export async function setCheckingBalance(userId: string, cents: number): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE accounts SET current_balance_cents = $2, available_balance_cents = $2
       WHERE user_id = $1 AND subtype = 'checking'`,
      [userId, cents],
    );
  } finally {
    await client.end();
  }
}

export async function addAlert(
  userId: string,
  alert: { type: string; title: string; body: string },
): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO alerts (id, user_id, type, key, title, body, urgent)
       VALUES ($1, $2, $3, $1, $4, $5, true)`,
      [`a${crypto.randomUUID()}`, userId, alert.type, alert.title, alert.body],
    );
  } finally {
    await client.end();
  }
}

// Turns two-factor on for a user (a placeholder secret: tests only check that a code is
// asked for, never enter a right one).
export async function enableTwoFactor(userId: string): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `UPDATE users SET mfa_enabled_at = now(), mfa_secret_encrypted = 'e2e-placeholder' WHERE id = $1`,
      [userId],
    );
  } finally {
    await client.end();
  }
}

// Another signed-in session for a user, as if on a second device (spec step 73).
export async function addSession(
  userId: string,
  userAgent: string,
): Promise<{ id: string; sessionToken: string }> {
  const id = `s${crypto.randomUUID().replaceAll("-", "")}`;
  const sessionToken = `e2e-session-${id}`;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO sessions (id, session_token, user_id, expires, user_agent, last_seen_at)
       VALUES ($1, $2, $3, now() + interval '1 day', $4, now() - interval '3 hours')`,
      [id, sessionToken, userId, userAgent],
    );
  } finally {
    await client.end();
  }
  return { id, sessionToken };
}

export async function sessionExists(id: string): Promise<boolean> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT 1 FROM sessions WHERE id = $1`, [id]);
    return rows.length > 0;
  } finally {
    await client.end();
  }
}

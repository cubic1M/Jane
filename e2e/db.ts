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

// How much Jane does on its own (the autopilot level), or null before it's chosen.
export async function autopilotLevel(userId: string): Promise<string | null> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT autopilot FROM users WHERE id = $1`, [userId]);
    return rows[0]?.autopilot ?? null;
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

// A payment-app transfer on the person's checking account (positive is money out).
export async function addTransfer(
  userId: string,
  transfer: { date: string; amountCents: number; description: string },
): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO transactions (id, user_id, account_id, source, date, amount_cents, description,
                                 pfc_primary, pfc_detailed, pending, updated_at)
       SELECT $1, $2, a.id, 'plaid', $3::date, $4, $5, 'TRANSFER_OUT', 'TRANSFER_OUT_ACCOUNT_TRANSFER', false, now()
       FROM accounts a WHERE a.user_id = $2 AND a.subtype = 'checking' LIMIT 1`,
      [
        `t${crypto.randomUUID()}`,
        userId,
        transfer.date,
        transfer.amountCents,
        transfer.description,
      ],
    );
  } finally {
    await client.end();
  }
}

// A payment on the person's checking account, with the description a dealer add-on would have
// (positive is money out), for the car loan add-on tests.
export async function addPayment(
  userId: string,
  payment: { date: string; amountCents: number; description: string },
): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO transactions (id, user_id, account_id, source, date, amount_cents, description,
                                 pfc_primary, pfc_detailed, pending, updated_at)
       SELECT $1, $2, a.id, 'plaid', $3::date, $4, $5, 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE', false, now()
       FROM accounts a WHERE a.user_id = $2 AND a.subtype = 'checking' LIMIT 1`,
      [`t${crypto.randomUUID()}`, userId, payment.date, payment.amountCents, payment.description],
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

// Posts one of Jane's chat messages as the app stores them (a reply with refs.options, say),
// for a test that needs one Claude would write: there's no Anthropic key in tests.
export async function addJaneMessage(
  userId: string,
  message: { kind: string; body: string; refs: object; actions: object[] },
): Promise<string> {
  const id = `e2em${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      // Stamped by this machine's clock, as the app stamps its own (the database's may lag).
      `INSERT INTO jane_messages (id, user_id, kind, body, refs, actions, dedupe_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $1, $7)`,
      [
        id,
        userId,
        message.kind,
        message.body,
        JSON.stringify(message.refs),
        JSON.stringify(message.actions),
        new Date(),
      ],
    );
  } finally {
    await client.end();
  }
  return id;
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

// A linked bank whose sign-in has lapsed (Plaid's ITEM_LOGIN_REQUIRED), with one account.
export async function addBankNeedingSignIn(userId: string, name: string): Promise<void> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO plaid_items (id, user_id, plaid_item_id, access_token_encrypted, institution_name, status, last_synced_at, updated_at)
       VALUES ($1, $2, $3, 'not-a-token', $4, 'login_required', now() - interval '3 days', now())`,
      [`pi${id}`, userId, `e2e-item-${id}`, name],
    );
  } finally {
    await client.end();
  }
}

// Read-only mode: only the demo bank (and trial people) get the concierge flow, so a test of
// the team's queue makes its CSV import count as the demo bank: its accounts as the demo
// bank's, under a demo item.
export async function treatAsDemoBank(userId: string): Promise<void> {
  const id = crypto.randomUUID().replaceAll("-", "");
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO plaid_items (id, user_id, plaid_item_id, access_token_encrypted, institution_name, updated_at)
       VALUES ($1, $2, $3, 'demo-token', 'Demo Bank', now())`,
      [`pi${id}`, userId, `demo-e2e-${id}`],
    );
    await client.query(`UPDATE accounts SET source = 'plaid' WHERE user_id = $1`, [userId]);
  } finally {
    await client.end();
  }
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

// The first scan of a demo-bank person has two parts: the chat opens once the brief is in, and
// the sectors' work (insurance shopping, the agenda, the numbers saved for Claude) finishes
// after. The last thing it does is save the numbers for Claude (a "primer" row), so a test that
// needs all of it waits for that, not for the chat to open.
export async function waitForFullScan(userId: string, timeoutMs = 150_000): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM jane_preferences WHERE user_id = $1 AND kind = 'system' AND key = 'primer'`,
        [userId],
      );
      if (rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("The first scan did not finish (no saved numbers for Claude).");
  } finally {
    await client.end();
  }
}

// A practice idea waiting for the person (Phase AW): a drift warning, as the practice scan
// keeps one in suggest-only mode.
export async function addPracticeIdea(userId: string): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT id FROM practice_portfolios WHERE user_id = $1`, [
      userId,
    ]);
    await client.query(
      `INSERT INTO practice_opportunities
        (id, portfolio_id, user_id, scanned_at, kind, ticker, key, amount_cents, headline, reason,
         confidence, details, status, trade_ids)
       VALUES ($1, $2, $3, now(), 'drift_warning', 'VTI', 'drift_warning:e2e', 50000,
         'A practice idea', 'For the end-to-end test.', 70, $4, 'suggested', '{}')`,
      [
        `e2e-idea-${userId}`,
        rows[0].id,
        userId,
        JSON.stringify({
          ask: {
            headline: "Check your mix: stocks are drifting toward the band",
            short: "Stocks are 4.2 points off target; the band is 5.",
            worthCents: 50000,
            worthKind: "risk",
          },
          figures: [{ label: "Stocks", value: "64.2%" }],
          caps: ["At most 2 a month"],
          confidence: { percent: 70, reason: "a fixed measure of the mix" },
          trades: [],
        }),
      ],
    );
  } finally {
    await client.end();
  }
}

// A news theme's idea, found just now (Phase AW): the scan keeps it waiting for a yes.
export async function addThemeIdea(userId: string): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT id FROM practice_portfolios WHERE user_id = $1`, [
      userId,
    ]);
    await client.query(
      `INSERT INTO practice_opportunities
        (id, portfolio_id, user_id, scanned_at, kind, ticker, key, amount_cents, headline, reason,
         confidence, details, status, trade_ids)
       VALUES ($1, $2, $3, now(), 'theme_idea', 'ITA', 'theme_idea:conflict_defense:e2e', 40000,
         'Defense when a war breaks out: $400 in ITA', 'For the end-to-end test.', 67, $4,
         'suggested', '{}')`,
      [
        `e2e-theme-${userId}`,
        rows[0].id,
        userId,
        JSON.stringify({
          ask: {
            headline: "Try $400 of ITA on news, in practice",
            short:
              "After news today: it beat the market in 5 of 7 past events; out in about a month.",
            worthCents: 40000,
            worthKind: "risk",
          },
          figures: [
            { label: "Why now", value: "Troops cross the border as a war breaks out (E2E wire)" },
            { label: "Past events", value: "Beat the market in 5 of 7" },
            { label: "On average against the market", value: "1.4%" },
            { label: "The risk", value: "Defense shares also hold airlines." },
            {
              label: "When to get out",
              value: "Out after 20 trading days, or sooner if it falls 8%.",
            },
          ],
          caps: ["Jane asks first, every time"],
          confidence: { percent: 67, reason: "it beat the market in 5 of 7 past events" },
          trades: [{ ticker: "ITA", side: "buy", amountCents: 40000 }],
        }),
      ],
    );
  } finally {
    await client.end();
  }
}

// A change the person made themselves and marked done (a do-it-yourself decision), so Home's
// Saved tile says "Saved so far" and opens on where it came from.
export async function addSavedChange(
  userId: string,
  { title, annualCents }: { title: string; annualCents: number },
): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const finding = `e2e-finding-${userId}-${annualCents}`;
    await client.query(
      `INSERT INTO findings (id, user_id, type, key, title, confidence, status, updated_at)
       VALUES ($1, $2, 'subscription_review', $3, $4, 'high', 'approved', now())`,
      [finding, userId, `e2e:${annualCents}`, title],
    );
    await client.query(
      `INSERT INTO decisions (id, finding_id, user_id, choice, card_snapshot, diy_done_at)
       VALUES ($1, $2, $3, 'diy', $4, now())`,
      [
        `e2e-decision-${userId}-${annualCents}`,
        finding,
        userId,
        JSON.stringify({
          title,
          annualSavingsCents: annualCents,
          actionType: "cancel_subscription",
        }),
      ],
    );
  } finally {
    await client.end();
  }
}

// A trade waiting in the trade pop-up (the paper account): the strategy's rule asking to sell
// $1,000 of VTI at $250.00, as the daily run leaves one (a new account holds VTI at every level).
export async function addPaperSignal(userId: string): Promise<string> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT id FROM paper_accounts WHERE user_id = $1`, [
      userId,
    ]);
    const id = `e2e-signal-${userId}`;
    await client.query(
      `INSERT INTO paper_signals
        (id, account_id, user_id, created_at, key, source, ticker, side, amount_cents, price_cents,
         reason, confidence, status)
       VALUES ($1, $2, $3, now(), 'rule:e2e:VTI:sell', 'rule', 'VTI', 'sell', 100000, 25000,
         'Your strategy''s rule at the month-end close: VTI down to 30% of the account.', 70, 'open')`,
      [id, rows[0].id, userId],
    );
    return id;
  } finally {
    await client.end();
  }
}

// An event the events overlay can act on (src/lib/events/run.ts): a chip boom in GDELT's coverage
// three days ago, public two days ago. On the sample prices its fund (SMH) has no price, so the
// overlay uses its stand-in, NVDA. Returns its key, for deleteMarketEvent.
export async function addMarketEvent(): Promise<string> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const key = `gdelt:chip_boom:e2e-${crypto.randomUUID()}`;
  try {
    await client.query(
      `INSERT INTO market_events (id, key, type, source, date, known_at, title, url, strength)
       VALUES ($1, $1, 'chip_boom', 'gdelt', $2, $3, $4, NULL, 3.1)`,
      [key, day(3), `${day(2)}T00:15:00Z`, "A chip boom: news coverage 3.1 times its usual level"],
    );
    return key;
  } finally {
    await client.end();
  }
}

export async function deleteMarketEvent(key: string): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM market_events WHERE key = $1`, [key]);
  } finally {
    await client.end();
  }
}

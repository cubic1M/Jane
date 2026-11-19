// A sample person for the connectors' fixture walk (docs/connectors.md, "The fixture walk"): the demo
// people send nothing to a brokerage, so none of them sees the investing card or its SnapTrade tap, and
// they stay as they are (their figures hold the accuracy baselines). This makes a separate one, on a
// local scratch database only.
//
//   node scripts/connector-walk-person.mjs                 a new person and a signed-in session
//   node scripts/connector-walk-person.mjs --transfers ID  after they link the demo bank at /connect:
//                                                          two transfers to Robinhood in the last 3 months
//
// DATABASE_URL must point at this machine (localhost, 127.0.0.1 or ::1); anything else is refused. The
// session is set as the walker's `authjs.session-token` cookie for the app's own host.

import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function localDatabase(url) {
  let host;
  try {
    host = new URL(url ?? "").hostname;
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(host);
}

export async function makeWalkPerson(client) {
  const id = `cwalk${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const token = randomBytes(32).toString("hex");
  await client.query(
    `insert into users (id, email, email_verified, updated_at) values ($1, $2, now(), now())`,
    [id, `${id}@walk.test`],
  );
  await client.query(
    `insert into sessions (id, session_token, user_id, expires) values ($1, $2, $3, now() + interval '1 day')`,
    [randomUUID(), token, id],
  );
  return { id, token };
}

// Two transfers of $250 to Robinhood, 12 and 40 days ago, on their first checking account.
export async function addTransfers(client, userId) {
  const { rows } = await client.query(
    `select a.id, a.source from accounts a where a.user_id = $1 and a.type = 'depository'
     order by a.created_at limit 1`,
    [userId],
  );
  if (!rows[0]) throw new Error("No checking account yet: link the demo bank at /connect first.");
  for (const days of [12, 40]) {
    await client.query(
      `insert into transactions (id, user_id, account_id, source, date, amount_cents, description,
         merchant_name, pfc_detailed, dedupe_key, updated_at)
       values ($1, $2, $3, $4, (now() - ($5 || ' days')::interval)::date, 25000, 'ROBINHOOD DES:FUNDS',
         'Robinhood', 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS', $6, now())`,
      [randomUUID(), userId, rows[0].id, rows[0].source, String(days), `walk-${randomUUID()}`],
    );
  }
  return 2;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!localDatabase(url)) {
    console.error("Refused: DATABASE_URL isn't a database on this machine.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const at = process.argv.indexOf("--transfers");
    if (at !== -1) {
      const n = await addTransfers(client, process.argv[at + 1]);
      console.log(`Added ${n} transfers to Robinhood. Open /investments.`);
    } else {
      const person = await makeWalkPerson(client);
      console.log(JSON.stringify(person));
      console.log(
        "Set the token as authjs.session-token, link the demo bank at /connect, then run",
      );
      console.log(`  node scripts/connector-walk-person.mjs --transfers ${person.id}`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

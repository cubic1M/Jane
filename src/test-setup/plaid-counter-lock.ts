import { Client } from "pg";

// Plaid's Item counter is one row for everyone (COUNTER_ID in src/lib/plaid/item-slots.ts). Test
// files that spend from it take turns, or one counts the other's Items: main went red on 11-13 when
// item-slots and bank-link-states landed in the same shard ("expected 2 to be 1", "expected 5 to
// be 1"). Each takes this lock for its whole file, on a connection of its own; it goes when that
// connection closes, so a crashed file can't hold it.
const PLAID_COUNTER_LOCK = 7_142_113;

export async function takePlaidCounter(url: string): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [PLAID_COUNTER_LOCK]);
  return async () => {
    await client.query("SELECT pg_advisory_unlock($1)", [PLAID_COUNTER_LOCK]);
    await client.end();
  };
}

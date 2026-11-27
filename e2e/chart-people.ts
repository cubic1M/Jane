import { Client } from "pg";
import { E2E_DATABASE_URL } from "./db";
import { historyBalances, type HistoryShape } from "./chart-history";

export * from "./chart-history";

// One checking account holding those balances, one snapshot a day, ending today.
export async function seedHistory(userId: string, shape: HistoryShape): Promise<number[]> {
  const balances = historyBalances(shape);
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const accountId = `acc${crypto.randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Checking', 'depository', 'checking', $3, now())`,
      [accountId, userId, balances[balances.length - 1]],
    );
    for (let i = 0; i < balances.length; i++) {
      const ago = shape.days - i;
      await client.query(
        `INSERT INTO balance_snapshots (id, user_id, account_id, date, balance_cents)
         VALUES ($1, $2, $3, (now() AT TIME ZONE 'UTC')::date - $4::int, $5)`,
        [`snap${crypto.randomUUID().replaceAll("-", "")}`, userId, accountId, ago, balances[i]],
      );
    }
  } finally {
    await client.end();
  }
  return balances;
}

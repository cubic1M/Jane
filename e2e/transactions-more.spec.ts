import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// The list showed only the latest 100, so a person with months of history could not read the
// older ones (founder 11-28: "ALL isn't showing ALL").
test("Transactions can be read all the way back, 100 at a time", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  const db = new Client({ connectionString: E2E_DATABASE_URL });
  await db.connect();
  try {
    const accountId = `a${crypto.randomUUID()}`;
    await db.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, updated_at)
       VALUES ($1, $2, 'csv', 'History checking', 'depository', 'checking', now())`,
      [accountId, userId],
    );
    // 230 days of one small charge each, oldest first, all different descriptions.
    await db.query(
      `INSERT INTO transactions (id, user_id, account_id, source, date, amount_cents, description,
                                 pending, updated_at)
       SELECT 't' || gen_random_uuid(), $2, $1, 'csv', (current_date - n), 500 + n,
              'History charge ' || n, false, now()
       FROM generate_series(1, 230) AS n`,
      [accountId, userId],
    );
  } finally {
    await db.end();
  }
  await signInWith(context, user.sessionToken, baseURL);

  await page.goto("/transactions");
  const rows = page.locator("ul.divide-y > li");
  await expect(rows).toHaveCount(100);
  await page.locator("[data-transactions-more]").click();
  await expect(rows).toHaveCount(200);
  await page.locator("[data-transactions-more]").click();
  await expect(rows).toHaveCount(230);
  // Nothing more to ask for.
  await expect(page.locator("[data-transactions-more]")).toHaveCount(0);
});

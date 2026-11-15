import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-15: right after a card statement's upload, /import asks "What do you owe on Chase card
// today?". The question was a form inside the upload's form, and a form in a form is no form at
// all: Save sent the page to /import?balance=2410 and saved nothing, so Loans & credit went on
// saying "Your files don't say what you owe yet". It saves where it's asked.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const CARD = [
  "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
  "11/09/2026,11/10/2026,SPOTIFY USA,Entertainment,Sale,-11.99,",
  "10/22/2026,10/23/2026,Payment Thank You-Mobile,,Payment,412.18,",
  "10/18/2026,10/19/2026,PURCHASE INTEREST CHARGE,Fees & Adjustments,Fee,-38.61,",
].join("\n");

async function cardBalance(id: string): Promise<number | null> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ cents: number | null }>(
      `SELECT current_balance_cents AS cents FROM accounts WHERE user_id = $1 AND subtype = 'credit card'`,
      [id],
    );
    return rows[0]?.cents ?? null;
  } finally {
    await client.end();
  }
}

test("what's owed on a card is saved where it's asked, right after the upload", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Chase5678_Activity20261114.CSV",
    mimeType: "text/csv",
    buffer: Buffer.from(CARD),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import 3 transactions/ }).click();

  const ask = page.locator("[data-import-saved] [data-balance-ask]");
  await ask.getByRole("textbox").fill("2410");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("[data-import-saved]")).toContainText(
    "Saved. Jane is updating your net worth.",
  );
  expect(new URL(page.url()).search).toBe("");
  await expect.poll(() => cardBalance(userId!)).not.toBeNull();
});

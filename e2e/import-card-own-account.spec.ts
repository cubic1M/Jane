import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-15: a student who had uploaded Chase checking chose a Chase card statement. The page
// opens on its first account, so the preview said "looks like a card statement, but it's going
// into Chase checking. If that's wrong, pick its account above", and one tap on Import would have
// put the card's rows in checking. Jane already knew it was a card's: the form goes to a new
// account named from the file, unless the person chose the account themselves.

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

async function withChaseChecking(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Chase checking', 'depository', 'checking', 401090, now())`,
      [`acc${crypto.randomUUID().replaceAll("-", "")}`, id],
    );
  } finally {
    await client.end();
  }
}

async function preview(page: import("@playwright/test").Page) {
  await page.locator('input[type="file"]').setInputFiles({
    name: "Chase5678_Activity20261114.CSV",
    mimeType: "text/csv",
    buffer: Buffer.from(CARD),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("button", { name: /^Import 3 transactions/ })).toBeVisible();
}

test("a card statement goes to a new card account, not the checking the page opened on", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await withChaseChecking(userId);
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/import");
  await preview(page);
  await expect(page.locator('select[name="accountId"]')).toHaveValue("new");
  await expect(page.locator('input[name="new.name"]')).toHaveValue("Chase card");
  await expect(page.getByText(/going into Chase checking/)).toHaveCount(0);
});

test("an account the person chose stays, with the warning", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await withChaseChecking(userId);
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/import");
  const select = page.locator('select[name="accountId"]');
  await select.selectOption("new");
  await select.selectOption({ label: "Chase checking (Checking)" });
  await preview(page);
  await expect(select).not.toHaveValue("new");
  await expect(page.getByText(/going into Chase checking/)).toBeVisible();
});

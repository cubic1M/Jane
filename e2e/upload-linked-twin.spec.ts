import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// A statement from an account Jane already gets from a linked bank (same bank, same last four):
// /import says so, the import waits, and skipping it leaves the account counted once.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

// A linked Chase checking account ····4321 with $2,500.00 in it.
async function linkChase(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO plaid_items (id, user_id, plaid_item_id, access_token_encrypted, institution_name, updated_at)
       VALUES ($1, $2, $3, 'not-a-token', 'Chase', now())`,
      [`pi${id}`, id, `e2e-chase-${id}`],
    );
    await client.query(
      `INSERT INTO accounts (id, user_id, source, item_id, name, mask, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'plaid', $3, 'Total Checking', '4321', 'depository', 'checking', 250000, now())`,
      [`ac${id}`, id, `pi${id}`],
    );
  } finally {
    await client.end();
  }
}

test("the same account as a linked bank's waits, and skipping it counts it once", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await linkChase(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Chase4321_Activity_20261027.CSV",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
        "DEBIT,10/20/2026,NETFLIX.COM,-15.49,ACH_DEBIT,2500.00,,",
      ].join("\n"),
    ),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  const note = page.locator("[data-linked-account]");
  await expect(note).toContainText(
    "You already link Total Checking ····4321 through Chase, so its transactions come in by themselves.",
  );
  await expect(page.getByRole("button", { name: "Import 1 transaction" })).toBeDisabled();

  await note.getByRole("button", { name: "Skip this file" }).click();
  await expect(note).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Import/ })).toHaveCount(0);

  // Counted once: net worth is the linked account's $2,500.00, and nothing was uploaded.
  await page.goto("/net-worth");
  await expect(
    page
      .locator("section div")
      .filter({ hasText: /^You have/ })
      .first(),
  ).toContainText("$2,500.00");
  await page.goto("/import");
  await expect(page.locator("[data-upload]")).toHaveCount(0);
});

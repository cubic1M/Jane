import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// QA round 32: card payments read as the card they paid, days read as people write them, and an
// upload-only person is pointed at an upload, not at linking.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(90_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const CARD_PAYMENT = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// Chase checking pays the Chase card: both sides of one $250 payment, as the two files word it.
async function addCardPayment(id: string): Promise<void> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  const key = () => `tx${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, updated_at)
       VALUES ($1, $3, 'csv', 'Chase checking', 'depository', 'checking', now()),
              ($2, $3, 'csv', 'Chase card', 'credit', 'credit card', now())`,
      [`chk${id}`, `card${id}`, id],
    );
    await client.query(
      `INSERT INTO transactions (id, user_id, account_id, source, dedupe_key, date, amount_cents,
                                 description, pfc_primary, pfc_detailed, pending, updated_at)
       VALUES ($1, $3, $4, 'csv', $1, '2026-10-05', 25000, 'CHASE CREDIT CRD AUTOPAY',
               'LOAN_PAYMENTS', $6, false, now()),
              ($2, $3, $5, 'csv', $2, '2026-10-06', -25000, 'Payment Thank You Web',
               'LOAN_PAYMENTS', $6, false, now())`,
      [key(), key(), id, `chk${id}`, `card${id}`, CARD_PAYMENT],
    );
  } finally {
    await client.end();
  }
}

test("transactions name card payments for their card, with readable days", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  // Nothing yet: the page says how to fill it.
  await page.goto("/transactions");
  await expect(page.getByRole("link", { name: "Upload a bank or card statement" })).toHaveAttribute(
    "href",
    "/import",
  );

  await addCardPayment(user.userId);
  await page.reload();
  const rows = page.locator("summary");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Chase card payment" })).toHaveCount(2);
  await expect(page.getByText("CHASE CREDIT CRD AUTOPAY")).toHaveCount(0);
  await expect(page.getByText("Payment Thank You Web")).toHaveCount(0);
  await expect(rows.first()).toContainText("Oct 6, 2026");
  await expect(page.locator("main")).not.toContainText(/\d{4}-\d{2}-\d{2}/);
});

test("investments with nothing uploaded point at the positions upload", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/investments");
  const empty = page.locator("[data-investments-empty]");
  await expect(empty).toContainText("No investment or retirement accounts yet.");
  await expect(empty).not.toContainText("link one");
  await empty.getByRole("link", { name: "Upload a positions download" }).click();
  await expect(page).toHaveURL(/\/import\/investments$/);
});

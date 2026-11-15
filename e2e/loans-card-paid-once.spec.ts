import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-15: a student whose checking pays a Chase card, with no card on file, read on Loans &
// credit "add its statement to see its balance and what it charges" and, right under it, "When you
// add your accounts (a card statement, or a bank that reports loans), they show here": the same
// ask twice. It's asked once, with the way to do it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

async function checkingThatPaysACard(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const account = `acc${crypto.randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Chase checking', 'depository', 'checking', 401090, now())`,
      [account, id],
    );
    await client.query(
      `INSERT INTO transactions (id, user_id, account_id, source, dedupe_key, date, amount_cents,
                                 description, pfc_primary, pfc_detailed, pending, updated_at)
       VALUES ($1, $2, $3, 'csv', $1, (now() - interval '20 days')::date, 41218,
               'CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224', 'LOAN_PAYMENTS',
               'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', false, now())`,
      [`t${crypto.randomUUID().replaceAll("-", "")}`, id, account],
    );
  } finally {
    await client.end();
  }
}

test("Loans & credit asks for the card's statement once", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await checkingThatPaysACard(userId);
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/loans");
  const main = page.getByRole("main");
  await expect(main).toContainText("You pay a credit card from checking");
  await expect(main.getByText(/When you add your accounts/)).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Add the card's statement/ })).toHaveAttribute(
    "href",
    "/import",
  );
});

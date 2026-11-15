import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-15: a new student's Settings said "Messages from Jane: Phone", though no phone was set
// up for notifications and Jane's messages came by email ("Phone notifications (by email until you
// turn them on)", one tap further). The branch says how they really reach the person.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("with no phone set up, Jane's messages read as coming by email", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Checking', 'depository', 'checking', 250000, now())`,
      [`acc${crypto.randomUUID().replaceAll("-", "")}`, userId],
    );
  } finally {
    await client.end();
  }
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/settings?focus=notify");
  const item = page.getByRole("treeitem", { name: /Messages from Jane/ });
  await expect(item).toContainText("Email for now");
  await expect(item).not.toContainText("Phone");
});

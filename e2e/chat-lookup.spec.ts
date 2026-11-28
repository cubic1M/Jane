import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, addPayment, deleteUser, signedInUser } from "./db";
import { CHAT, answerTo } from "./chat-page";
import { signInWith } from "./session";

// The founder's own question (11-28), "did I buy something from california arts before", through
// the whole chat: the model is the scripted fake (src/lib/jane-agent/fake-chat-claude.ts), which asks
// for the search tool; the tool reads two purchases written as a bank writes them, and the answer
// names their dates and amounts. SHOTS_DIR, when set, saves a picture of the answer.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("a purchase from before is found whatever the bank called it, and the answer says when", async ({
  context,
  page,
  baseURL,
}, info) => {
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
  await addPayment(userId, {
    date: "2025-03-14",
    amountCents: 4_820,
    description: "CALIFORNIA ARTS 0412 SAN FRANCISCO CA",
  });
  await addPayment(userId, {
    date: "2025-09-02",
    amountCents: 3_175,
    description: "POS DEBIT CA ARTS SUPPLY #12",
  });
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto(CHAT);
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached({
    timeout: 60_000,
  });

  const box = page.getByRole("textbox", { name: "Message Jane" });
  await box.fill("did I buy something from california arts before");
  await box.press("Enter");
  const answer = await answerTo(page, "California Arts", "2025-03-14");
  await expect(answer).toContainText("$48.20");
  // Never the dead-end line.
  await expect(page.getByText(/Please ask again|couldn't finish an answer/)).toHaveCount(0);
  if (process.env.SHOTS_DIR) {
    await page.screenshot({ path: `${process.env.SHOTS_DIR}/lookup-${info.project.name}.png` });
  }
});

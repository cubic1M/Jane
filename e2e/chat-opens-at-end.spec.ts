import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser, signedInUser } from "./db";
import { CHAT } from "./chat-page";

// The chat opens at its newest message, as the side panel and the phone's sheet show it (night
// QA 10-30: with a conversation longer than the panel, it opened at the oldest, because the
// message box it scrolled to is pinned to the bottom and already counted as in view).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a long chat opens at its newest message", async ({ context, page, baseURL }) => {
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
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  for (let i = 1; i <= 8; i++) {
    await addJaneMessage(userId, {
      kind: "user",
      body: `Question number ${i}`,
      refs: {},
      actions: [],
    });
    await addJaneMessage(userId, {
      kind: "reply",
      body: `Answer number ${i}. ${"A long enough answer to take some room in the chat. ".repeat(3)}`,
      refs: {},
      actions: [],
    });
  }

  // The side panel's size.
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(CHAT);
  await expect(page.getByText("Answer number 8.")).toBeInViewport({ timeout: 60_000 });
  await expect(page.getByText("Question number 1", { exact: true })).not.toBeInViewport();
});

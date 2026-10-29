import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser, signedInUser } from "./db";
import { CHAT } from "./chat-page";

// Each sign-in starts the chat empty (src/lib/chat-start.ts): yesterday's conversation is still
// stored, but this session's chat doesn't show it; what's said from now on does.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// An uploaded account (so the chat opens) and a conversation from before this sign-in.
async function withYesterday(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Checking', 'depository', 'checking', 250000, now())`,
      [`acc${crypto.randomUUID().replaceAll("-", "")}`, id],
    );
    for (const [kind, body] of [
      ["user", "Yesterday's question about Hulu"],
      ["reply", "Yesterday's answer about Hulu"],
    ]) {
      await client.query(
        `INSERT INTO jane_messages (id, user_id, kind, body, dedupe_key, status, created_at)
         VALUES ($1, $2, $3, $4, $1, 'answered', now() - interval '1 day')`,
        [`e2em${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`, id, kind, body],
      );
    }
  } finally {
    await client.end();
  }
}

test("a new sign-in starts the chat empty; older messages stay stored, unseen", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await withYesterday(userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto(CHAT);
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached({
    timeout: 60_000,
  });
  await expect(page.getByText("Yesterday's question about Hulu")).toHaveCount(0);
  await expect(page.getByText("Yesterday's answer about Hulu")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Show earlier" })).toHaveCount(0);

  // What comes after the sign-in shows.
  await addJaneMessage(userId, {
    kind: "reply",
    body: "Today's answer, after this sign-in",
    refs: {},
    actions: [],
  });
  await page.reload();
  await expect(page.getByText("Today's answer, after this sign-in")).toBeVisible();
  await expect(page.getByText("Yesterday's question about Hulu")).toHaveCount(0);
});

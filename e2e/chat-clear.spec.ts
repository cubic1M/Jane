import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { CHAT, answerTo } from "./chat-page";
import { signInWith } from "./session";

// "Clear chat" (founder 11-28): one tap asks, a second deletes every message for good, and the chat
// starts empty, also after a reload. Runs on the desktop and the phone project.
// The model is the scripted fake (src/lib/jane-agent/fake-chat-claude.ts).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

async function rows(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM jane_messages WHERE user_id = $1 AND kind IN ('user','reply')",
      [id],
    );
    return rows[0].n as number;
  } finally {
    await client.end();
  }
}

test("Clear chat deletes every message after one confirm, and the chat stays empty", async ({
  context,
  page,
  baseURL,
}, info) => {
  const user = await signedInUser("user");
  userId = user.userId;
  // An uploaded account, so the chat opens.
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
  await page.goto(CHAT);
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached({
    timeout: 60_000,
  });

  // Say something, and get the answer.
  const box = page.getByRole("textbox", { name: "Message Jane" });
  await box.fill("Should I pay off my card before saving?");
  await box.press("Enter");
  await answerTo(page, "could save you the most");
  expect(await rows(userId)).toBeGreaterThanOrEqual(2);

  // One tap asks, in the words of what happens; "Keep chat" changes nothing.
  await page.getByRole("button", { name: "Clear chat" }).click();
  const ask = page.getByRole("group", { name: "Clear chat" });
  await expect(ask).toContainText(
    "This deletes every message in this chat for good, including pinned answers. What Jane knows about you stays.",
  );
  await ask.getByRole("button", { name: "Keep chat" }).click();
  expect(await rows(userId)).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("could save you the most")).toBeVisible();

  // The second tap deletes.
  await page.getByRole("button", { name: "Clear chat" }).click();
  if (process.env.SHOTS_DIR) {
    await page.screenshot({
      path: `${process.env.SHOTS_DIR}/clear-confirm-${info.project.name}.png`,
    });
  }
  await page.getByRole("button", { name: "Delete every message" }).click();
  await expect(page.getByText("could save you the most")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Should I pay off my card before saving?")).toHaveCount(0);
  expect(await rows(userId)).toBe(0);

  // Still empty after a reload, with the new-chat note and a message box that works.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached();
  await expect(page.getByRole("list", { name: "Messages" })).toHaveCount(0);
  await expect(page.locator("[data-memory-note]")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Jane" })).toBeEditable();
});

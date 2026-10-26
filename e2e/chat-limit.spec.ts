import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { answerTo, landInChat } from "./chat-page";

// Founder (2026-10-26): one person can't use up the month's chat budget. Past their daily
// allowance of written answers, a typed question gets a short, honest note and whatever the
// data answers for free, never a broken chat; and the founder sees the hit on /admin/chat.
// No Claude here (no key in e2e): the person's day is marked as spent in the database.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

const NOTE = "I've hit today's limit for written answers, back tomorrow.";
const DAY_MS = 86_400_000;

const users: string[] = [];
test.afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(id);
});

// Today's Claude spend for the person (hundredths of a cent), from midnight UTC, past any cap.
async function spendTheDay(userId: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, $3)
       ON CONFLICT (key, window_start) DO UPDATE SET count = $3`,
      [`chatspend:${userId}`, new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS), 1_000_000],
    );
  } finally {
    await client.end();
  }
}

test("past the day's limit, Jane says so briefly and still answers from the data", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  users.push(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible({
    timeout: 60_000,
  });
  await spendTheDay(user.userId);

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  // A question the data answers: the note, then that answer.
  await ask.fill("what is my safe to spend");
  await ask.press("Enter");
  const free = await answerTo(page, NOTE, "safe to spend");
  await expect(free).toContainText(/\$[\d,]+\.\d\d/);
  // One it can't: just the note, and the chat still works.
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await ask.fill("give me your honest take on my money habits");
  await ask.press("Enter");
  const notes = page
    .getByRole("list", { name: "Messages" })
    .getByRole("listitem")
    .filter({ hasText: NOTE });
  await expect(notes).toHaveCount(2, { timeout: 45_000 });
  await expect(notes.last()).not.toContainText(/couldn't|error|went wrong/i);
  await expect(ask).toBeEditable();

  // The founder sees today's spend and the hit.
  const admin = await signedInUser("admin");
  users.push(admin.userId);
  await context.clearCookies();
  await context.addCookies([
    { name: "authjs.session-token", value: admin.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/admin/chat");
  await expect(page.getByRole("heading", { level: 1, name: "Today's chat spend" })).toBeVisible();
  const atLimit = page.getByRole("definition").filter({ hasText: /answered from the data/ });
  await expect(atLimit).toContainText(/[1-9]\d* (person|people), [1-9]\d* messages?/);
});

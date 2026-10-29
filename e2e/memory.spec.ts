import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { CHAT } from "./chat-page";

// What Jane knows about you (src/lib/memory/): signed in, the chat starts empty and says Jane
// remembers; "See what it knows" opens the page, which lists each fact with where it came from
// and how sure Jane is; Forget removes one, for good.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// An uploaded account (so the chat opens) and two things Jane learned earlier.
async function withMemory(id: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  const fact = (key: string, value: string, label: string, source: string, confidence: number) =>
    client.query(
      `INSERT INTO user_facts (id, user_id, key, value, label, source, confidence, first_seen, last_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '3 days', now() - interval '3 days')`,
      [
        `uf${crypto.randomUUID().replaceAll("-", "")}`,
        id,
        key,
        JSON.stringify({ value }),
        label,
        source,
        confidence,
      ],
    );
  try {
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Checking', 'depository', 'checking', 250000, now())`,
      [`acc${crypto.randomUUID().replaceAll("-", "")}`, id],
    );
    await fact("housing", "rent", "You rent your home", "chat", 80);
    await fact("main_bank", "Chase", "Your main bank is Chase", "detector", 75);
  } finally {
    await client.end();
  }
}

test("the chat starts empty, and a fact Jane knows can be forgotten", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await withMemory(userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto(CHAT);
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeAttached({
    timeout: 60_000,
  });
  // Nothing typed and nothing answered: a fresh conversation, with the line about memory.
  await expect(page.getByText("Jane remembers what you've told it.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Jane" })).toHaveValue("");
  const link = page.getByRole("link", { name: "See what it knows" });
  await expect(link).toHaveAttribute("href", "/settings/memory");

  await page.goto("/settings/memory");
  await expect(
    page.getByRole("heading", { level: 1, name: "What Jane knows about you" }),
  ).toBeVisible();
  const facts = page.getByRole("list", { name: "What Jane knows" }).getByRole("listitem");
  await expect(facts).toHaveCount(2);
  const rent = facts.filter({ hasText: "You rent your home" });
  await expect(rent).toContainText("You said it in the chat");
  await expect(rent).toContainText("80% sure");

  // Forgotten: gone from the page, and still gone after a reload.
  await expect(async () => {
    await rent
      .getByRole("button", { name: "Forget: You rent your home" })
      .click({ timeout: 5_000 });
    await expect(facts.filter({ hasText: "You rent your home" })).toHaveCount(0, {
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });
  await page.reload();
  await expect(facts).toHaveCount(1);
  await expect(facts.first()).toContainText("Your main bank is Chase");
});

import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// A conversation from before the chat answered everything (docs/feature-audit.md, cluster 5).
async function earlierConversation(owner: string): Promise<string> {
  const id = `e2eask${crypto.randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO ask_conversations (id, user_id, title, updated_at) VALUES ($1, $2, $3, now())`,
      [id, owner, "How much did I spend on food?"],
    );
    await client.query(
      `INSERT INTO ask_messages (id, conversation_id, user_id, role, content)
       VALUES ($1, $3, $4, 'user', 'How much did I spend on food?'),
              ($2, $3, $4, 'assistant', 'You spent $412.00 on food last month.')`,
      [`${id}q`, `${id}a`, id, owner],
    );
  } finally {
    await client.end();
  }
  return id;
}

test("earlier Ask Jane conversations can be read and deleted, and new questions go to the chat", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  const id = await earlierConversation(userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto(`/ask?c=${id}`);
  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation).toContainText("How much did I spend on food?");
  await expect(conversation).toContainText("You spent $412.00 on food last month.");
  // Nothing to type into here: questions go to the one chat.
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ask in the chat ›" })).toHaveAttribute(
    "href",
    "/chat",
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/ask");
  await expect(page.getByText("You have no earlier conversations.")).toBeVisible();
});

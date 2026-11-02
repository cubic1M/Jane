import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { answerTo, landInChat } from "./chat-page";

// Founder (11-01): a message whose first answer trips a safety check still gets Claude's own
// answer, never a canned line. The model is the scripted fake (src/lib/jane-agent/fake-chat-claude.ts,
// CHAT_FAKE_CLAUDE=1 in playwright.config.ts): its first draft promises a result, the guardrails
// block it, Jane asks once more with the reason, and the rewrite is what the person reads.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

const QUESTION = "Should I pay off my card before saving?";

const users: string[] = [];
test.afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(id);
});

test("a blocked answer is rewritten by Claude, not replaced by a canned line", async ({
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

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill(QUESTION);
  await ask.press("Enter");

  // The rewrite, in Claude's words.
  const answer = await answerTo(page, "could save you the most");
  await expect(answer).toContainText("I can help you plan the payments");
  // Never the blocked draft, and never a prewritten line.
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(messages.filter({ hasText: "definitely" })).toHaveCount(0);
  await expect(
    messages.filter({
      hasText:
        /I couldn't answer that one in a way I'm sure is right|I couldn't look into that|Sorry, I couldn't finish/,
    }),
  ).toHaveCount(0);
  await expect(ask).toBeEditable();
});

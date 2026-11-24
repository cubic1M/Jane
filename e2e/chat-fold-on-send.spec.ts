import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { CHAT } from "./chat-page";
import { demoPerson } from "./demo-person";

// Founder 11-24: "suggestions belong only in the suggestion box". Beta walk 11-12 had folded the
// chat's card on a phone once a message was sent, so the answer showed; the chat now has no card
// of Jane's own to fold. The demo person has a dock full of suggestions, and on a phone the chat
// sheet shows none of them, before or after a message is sent: the answer lands where it is
// typed. The dock is on Home (e2e/floating-cards.spec.ts).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("on a phone, the chat holds no suggestion, so a sent message's answer shows", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  // The dock has cards: Home's folded line counts them.
  await page.goto("/home");
  await expect(
    page.getByRole("region", { name: "Suggestions for you" }).locator('[data-card-state="folded"]'),
  ).toBeVisible({ timeout: 60_000 });

  await page.goto(CHAT);
  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  await expect(overlay).toHaveCount(0);

  await ask.fill("safe to spend");
  await ask.press("Enter");
  const answer = page
    .getByRole("list", { name: "Messages" })
    .getByRole("listitem")
    .filter({ hasText: /safe to spend/ })
    .last();
  await expect(answer).toBeVisible({ timeout: 45_000 });
  await expect(overlay).toHaveCount(0);
});

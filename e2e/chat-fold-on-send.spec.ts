import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { CHAT } from "./chat-page";
import { demoPerson } from "./demo-person";

// Beta walk 11-12: on a phone the chat is a half-height sheet, and the day's card floating over it
// covered every new message, so a typed question's answer landed out of sight under it. Sending a
// message folds the cards to their one line; a tap opens them again.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("on a phone, sending a message folds the cards so the answer shows", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto(CHAT);

  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  const showing = overlay.locator('[data-card-state="showing"]');
  const folded = overlay.locator('[data-card-state="folded"]');
  await expect(showing).toBeVisible({ timeout: 60_000 });
  await expect(folded).toHaveCount(0);

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("safe to spend");
  await ask.press("Enter");

  await expect(folded).toBeVisible();
  await expect(showing).toHaveCount(0);
  const answer = page
    .getByRole("list", { name: "Messages" })
    .getByRole("listitem")
    .filter({ hasText: /safe to spend/ })
    .last();
  await expect(answer).toBeVisible({ timeout: 45_000 });

  await folded.click();
  await expect(showing).toBeVisible();
});

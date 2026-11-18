import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { landInChat } from "./chat-page";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { signInWith } from "./session";

// Debugger 11-15: choosing Jane's insurance pick posts, and every post refreshes the page
// (src/lib/page-cache.ts). The pick's cards then went, as the shop was answered, and with them
// "Chosen: Lighthouse Insurance (demo)": a moment after the tap the page showed nothing was
// chosen, and main's e2e (insurance.spec.ts:167) failed when the refresh came first. The quotes
// page now says what was chosen, however often it's loaded. This test replaced that one: it takes
// the same steps and checks the same "I'm switching you now", after a reload.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("the chosen insurance stays on the quotes page after it reloads", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);
  await waitForFullScan(userId);
  await expect(async () => {
    await page.goto("/insurance");
    await pickItem(page, "Insurance", "Your policies", "GEICO car");
    await page.getByRole("link", { name: "Compare quotes" }).click({ timeout: 10_000 });
    await expect(page.getByText("Jane's pick")).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  const pick = page.locator("li[data-option-id]").filter({ hasText: "Jane's pick" });
  await pick.getByRole("button", { name: /^Choose / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Chosen:" })).toBeVisible();

  // Loaded again once the pick has reached the server (its post may still be on its way).
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "Chosen:" })).toContainText(
      "I'm switching you now",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText("Jane's pick")).toHaveCount(0);
});

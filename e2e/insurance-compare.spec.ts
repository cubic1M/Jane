import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";

// The insurance comparison cards can be seen in Try Jane (gap audit 2: "not reached on
// /insurance/quotes as the renter, the family or the default demo bank"). The family's car
// policy renews soon, so Jane shops it when the bank links; from the Insurance tree, the
// policy's Compare quotes opens its pick and the other cheaper quotes side by side.
// Trial people are deleted after TRIAL_HOURS.

test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");
test.setTimeout(300_000);

test("a sample family reaches the insurance comparison cards from the Insurance tree", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('select[name="person"]').selectOption("family");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  // Once Jane has read every account (the shop runs in that work).
  await expect(async () => {
    await page.goto("/insurance");
    await expect(page.locator("[data-scan-bar]")).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 240_000 });

  const policy = await pickItem(page, "Insurance", "Your policies", "GEICO car");
  await policy.getByRole("link", { name: "Compare quotes" }).click();
  await expect(page).toHaveURL(/\/insurance\/quotes\?/);
  const cards = page.getByRole("region", { name: "Jane's pick" });
  await expect(cards).toBeVisible({ timeout: 30_000 });
  const options = cards.locator("li[data-option-id]");
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  await expect(options.filter({ hasText: "JANE'S PICK" })).toHaveCount(1);
  await expect(cards.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
});

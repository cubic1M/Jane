import { expect, test } from "@playwright/test";

// The loan comparison cards can be seen in Try Jane (QA round 9: "No sample person has a loan
// with Compare options"). The renter's cards could be one cheaper loan: it sits with the other
// loan choices under Cheaper loans, and Compare options there opens the options side by side.
// Trial people are deleted after TRIAL_HOURS.

test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");
test.setTimeout(300_000);

test("a sample person's card debt has Compare options under Cheaper loans", async ({ page }) => {
  await page.goto("/");
  await page.locator('select[name="person"]').selectOption("renter");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  // Once Jane has read every account.
  await expect(async () => {
    await page.goto("/loans");
    await expect(page.locator("[data-scan-bar]")).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 240_000 });

  await page.goto("/loans?focus=cheaper:consolidation");
  const compare = page.getByRole("link", { name: /Compare options/ });
  await expect(compare).toBeVisible();
  await compare.click();
  const cards = page.getByTestId("comparison");
  await expect(cards).toBeVisible({ timeout: 30_000 });
  expect(await cards.locator("[data-option-id]").count()).toBeGreaterThanOrEqual(2);
});

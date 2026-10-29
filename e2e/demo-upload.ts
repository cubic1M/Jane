import { expect, type Page } from "@playwright/test";

// The demo-video checks' upload, into a new account, until the import chip says it's done: the
// sample card statement (subscriptions, a price rise, card interest) by default, or a checking
// file, which has balances for the net worth chart.
export async function uploadSampleCard(page: Page, file = "e2e/fixtures/sample-card.csv") {
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page.locator('[data-import-chip="done"]')).toBeVisible({ timeout: 120_000 });
}

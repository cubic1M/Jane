import { expect, type Page } from "@playwright/test";

// The report opens with the three findings that matter most and folds the rest behind "more"
// (docs/design/area-pages.md): opens a finding wherever it is.
export async function openFinding(page: Page, name: RegExp): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const link = page.getByRole("link", { name });
  if (!(await link.first().isVisible())) {
    await page.locator("[data-report-more] summary").click();
  }
  await link.first().click();
}

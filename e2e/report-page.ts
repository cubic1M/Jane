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

// A finding's link showing on the report, opening "more" if it's folded there. Again if the
// report refreshes (when the first scan ends) and folds it away.
export async function expectFinding(page: Page, name: RegExp, timeout = 15_000): Promise<void> {
  const link = page.getByRole("link", { name }).first();
  await expect(async () => {
    if (!(await link.isVisible())) {
      const more = page.locator("[data-report-more]:not([open]) > summary");
      if (await more.count()) await more.click();
    }
    await expect(link).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout });
}

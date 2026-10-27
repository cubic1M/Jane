import { expect, type Page } from "@playwright/test";

// After tapping Import on /import: the rows are saved at once and the rest runs in the
// background (src/lib/import/background.ts), its progress in the chip at the top of every page.
// Waits for the chip to say it's done, then opens the report.
export async function waitForImport(page: Page, { open = "/report" }: { open?: string } = {}) {
  const saved = page.locator("[data-import-saved]");
  await expect(saved).toBeVisible({ timeout: 60_000 });
  // This upload's chip, not an earlier one still saying it's done.
  const run = await saved.getAttribute("data-import-saved");
  await expect(page.locator(`[data-import-chip="done"][data-import-run="${run}"]`)).toBeVisible({
    timeout: 120_000,
  });
  await page.goto(open);
}

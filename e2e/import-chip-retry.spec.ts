import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId).catch(() => undefined);
  userId = undefined;
});

const FILE = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "DEBIT,10/01/2026,NETFLIX.COM,-15.49,DEBIT_CARD,900.00,",
  "DEBIT,09/01/2026,NETFLIX.COM,-15.49,DEBIT_CARD,915.49,",
  "DEBIT,08/01/2026,NETFLIX.COM,-15.49,DEBIT_CARD,930.98,",
].join("\n");

// A refused or lost answer isn't "nothing to show": one 429 (the limits are per IP, so a shared
// network can reach them) blanked the chip, which then never asked again, and the page's numbers
// never reloaded when the upload finished.
test("the upload chip outlasts answers it couldn't get", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "chip.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(FILE),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  let refused = 0;
  await page.route("**/api/import/status", (route) => {
    if (refused >= 2) return route.continue();
    refused += 1;
    return route.fulfill({ status: 429, body: "Too many requests" });
  });
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  const saved = page.locator("[data-import-saved]");
  await expect(saved).toBeVisible({ timeout: 60_000 });
  const run = await saved.getAttribute("data-import-saved");
  await expect(page.locator(`[data-import-chip="done"][data-import-run="${run}"]`)).toBeVisible({
    timeout: 60_000,
  });
  expect(refused).toBe(2);
});

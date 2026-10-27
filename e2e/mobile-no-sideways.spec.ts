import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// On a phone nothing widens the page past the screen. The chat's sheet, waiting off-screen with
// its one-line loading bar, made /import 841px wide on a 412px phone: the page zoomed out and the
// Import tap landed elsewhere (new-user pass, round 14).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("a phone's /import is never wider than the screen, and Import takes the tap", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "a phone's layout");
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    // Long names, as phones save them, and a long description.
    name: "Chase1234_Activity_20261027_downloaded_from_the_website_on_my_phone_again_final_FINAL (3).CSV",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
        'DEBIT,10/20/2026,"AMAZON MARKETPLACE PURCHASE WITH A VERY LONG DESCRIPTION THAT NEVER ENDS 1234567890",-15.49,ACH_DEBIT,2500.00,,',
      ].join("\n"),
    ),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page
    .locator('[name="new.name"]')
    .fill("My everyday checking account at the credit union downtown by the park");
  // Give the chat's sheet time to start loading in the background.
  await page.waitForTimeout(1500);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Import 1 transaction" }).click({ timeout: 15_000 });
  await expect(page.locator("[data-import-saved]")).toContainText("Saved");
});

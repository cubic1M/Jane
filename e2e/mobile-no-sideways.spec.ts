import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// An upload from a phone with long names, as phones save them: the page stays the screen's width
// and the import goes through. (Round 14 of the new-user passes: the chat's waiting sheet made
// /import wider than a 412px phone; globals.css clips that. Playwright's "is anything over the
// button" check, used before, failed in CI's headless Chrome whether or not the page was wide, so
// the import's outcome is what's judged.)

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("a phone uploads with long names: no sideways scroll, and the import goes through", async ({
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
  // What the person feels: the page doesn't scroll sideways, isn't zoomed out, and the tap lands
  // (scrollWidth isn't asked: a clipped page may still report its content's width).
  const view = await page.evaluate(() => {
    window.scrollTo(600, window.scrollY);
    return { x: window.scrollX, scale: window.visualViewport?.scale ?? 1 };
  });
  expect(view).toEqual({ x: 0, scale: 1 });
  // The tap, as a phone makes it: the keyboard closes (the field loses focus), then one tap where
  // the button is, judged by what it did.
  await page.locator('[name="new.name"]').blur();
  await page.getByRole("button", { name: "Import 1 transaction" }).click({ force: true });
  await expect(page.locator("[data-import-saved]")).toContainText("Saved");
});

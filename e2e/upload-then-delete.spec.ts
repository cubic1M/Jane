import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// An upload's "Done" chip is gone once the person's data is: "Delete all my data" leads to
// /goodbye in the page, and the chip there asks again and finds nothing (import-debugger: it
// stayed, "Done: found $228/yr · See findings", for a person whose account was gone).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId).catch(() => undefined);
  userId = undefined;
});

test("after Delete all my data, /goodbye shows no import chip", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/import");
  await page
    .locator('input[type="file"]')
    .setInputFiles("src/data-sources/csv/__fixtures__/chase-credit-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page, { open: "/settings#delete" });
  // The chip still says the upload is done here.
  await expect(page.locator('[data-import-chip="done"]')).toBeVisible();

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await expect(page.getByRole("heading", { name: "Your data is deleted" })).toBeVisible();
  await expect(page.locator("[data-import-chip]")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Someone with a linked bank (the demo bank stands in) who uploads a statement: /import offers
// only uploaded accounts to put it in, and opens on a new one (new-user pass, round 9: it opened
// on the linked "Demo Checking", and Import then failed).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("with a linked bank, an upload goes to a new account, never a linked one", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 120_000 });

  await page.goto("/import");
  const select = page.locator('select[name="accountId"]');
  await expect(select).toHaveValue("new");
  await expect(select.locator("option")).toHaveText(["A new account from these files"]);

  await page
    .locator('input[type="file"]')
    .setInputFiles("src/data-sources/csv/__fixtures__/chase-credit-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await expect(page.locator("[data-import-saved]")).toContainText("Saved");
});

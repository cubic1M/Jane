import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// /import's upload history for a screen reader and a keyboard: each row's Remove button says what
// it removes, and asking moves the focus to the answer.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const FIXTURES = "src/data-sources/csv/__fixtures__";

test("each Remove button names what it removes, and the answer gets the focus", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  for (const file of ["chase-credit-card.csv", "wells-fargo.csv"]) {
    await page.goto("/import");
    await page.locator('select[name="accountId"]').selectOption("new");
    await page.locator('input[type="file"]').setInputFiles(`${FIXTURES}/${file}`);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
    await waitForImport(page, { open: "/import" });
  }

  await expect(
    page.getByRole("button", { name: "Remove this upload: chase-credit-card.csv" }),
  ).toBeVisible();
  const wf = page.getByRole("button", { name: "Remove this upload: wells-fargo.csv" });
  await expect(wf).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove account: Chase card" })).toBeVisible();

  await wf.click();
  await expect(page.getByRole("button", { name: "Yes, remove them" })).toBeFocused();
});

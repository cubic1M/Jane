import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";

// Debugger 11-15: a student who only uploaded a checking statement opened Investing and found one
// tree node, "Practice portfolio", whose page said "The practice portfolio is only available in
// demo advice mode for now." The page already says, above the tree, that there are no investment
// accounts yet and that Jane can run a practice portfolio on made-up money (see it on sample
// data). Without demo advice the tree has no practice node, and with nothing at all in it there's
// no empty tree either.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(150_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("an upload-only student's Investing page has no node leading to a closed page", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(page.context(), user.sessionToken, baseURL);

  await page.goto("/import");
  await page
    .locator('input[type="file"]')
    .setInputFiles("src/data-sources/csv/__fixtures__/bofa-checking.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await waitForImport(page, { open: "/investments" });

  await expect(page.getByText("No investment or retirement accounts yet.")).toBeVisible();
  // The one way in for them: the line above the tree, to the sample data.
  await expect(page.getByRole("link", { name: "See it on sample data" })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /Practice portfolio/ })).toHaveCount(0);
});

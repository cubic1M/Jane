import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// A statement whose rows don't lead to its own balance: the person is told before saving, when it
// saves, and on the upload's line afterwards (src/data-sources/csv/control-totals.ts).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const SHORT_A_ROW = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  "DEBIT,10/20/2026,COFFEE SHOP,-5.00,MISC,1395.00,",
  "DEBIT,10/18/2026,GROCER,-80.00,MISC,900.00,",
  "DEBIT,10/17/2026,GAS STATION,-20.00,MISC,980.00,",
  "DEBIT,10/16/2026,BAKERY,-12.00,MISC,1000.00,",
].join("\n");

test("a statement that doesn't add up says so before and after it's saved", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "chase.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(SHORT_A_ROW),
  });
  await page.getByRole("button", { name: /Preview/ }).click();

  const warning =
    /The balance doesn't follow from the rows on 1 day, first on Oct 20, 2026: \$500\.00/;
  await expect(page.getByText("This file doesn't fully add up:")).toBeVisible();
  await expect(page.getByText(warning)).toBeVisible();

  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  const saved = page.locator("[data-import-saved]");
  await expect(saved).toBeVisible();
  await expect(saved.getByText(warning)).toBeVisible();

  await waitForImport(page, { open: "/import" });
  await expect(page.locator("[data-upload]").getByText(warning)).toBeVisible();
});

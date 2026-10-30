import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// A statement from a year ago, uploaded by mistake (night QA 10-30): it read as today's balance
// and "Nothing to fix right now". The preview says the files are old before they're imported.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const usDate = (d: Date) =>
  `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
const chase = (daysAgo: number) => {
  const d = usDate(new Date(Date.now() - daysAgo * 86_400_000));
  return [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    `CREDIT,${d},"ACME CORP PAYROLL PPD",2000.00,ACH_CREDIT,2000.00,,`,
  ].join("\n");
};

test("an old statement is called old in the preview; a recent one isn't", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/import");
  const file = page.locator('input[type="file"]');
  await file.setInputFiles({
    name: "old.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(chase(370)),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("[data-upload-old]")).toContainText(
    "The newest row in this file is from",
  );

  await file.setInputFiles({
    name: "new.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(chase(3)),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("button", { name: /^Import 1 transaction/ })).toBeVisible();
  await expect(page.locator("[data-upload-old]")).toHaveCount(0);
});

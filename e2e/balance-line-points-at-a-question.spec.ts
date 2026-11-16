import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-16: after a U.S. Bank upload (no balance in the file), the upload's result asked
// for the balance, and "Your accounts" said "Add it below" over no field (#1888 holds the list's
// copy back while the upload's shows). The line only shows while the list asks; after Skip, it
// and the list's question come back together.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

const day = (offset: number) =>
  new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
// A made-up U.S. Bank export.
const statement = () =>
  [
    `"Date","Transaction","Name","Memo","Amount"`,
    `"${day(5)}","DEBIT","CUB FOODS","Download from usbank.com.","-42.93"`,
    `"${day(12)}","CREDIT","UNIV OF MINNESOTA PAYROLL","Download from usbank.com.","640.00"`,
    `"${day(26)}","CREDIT","UNIV OF MINNESOTA PAYROLL","Download from usbank.com.","640.00"`,
    `"${day(30)}","DEBIT","T-MOBILE","Download from usbank.com.","-45.00"`,
  ].join("\n");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("'Add it below' only while the list asks", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(page.context(), user.sessionToken, baseURL);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "usbank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(statement()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();

  const question = page.getByRole("group", { name: /today\?$/ });
  const line = page.getByText("One account has no balance yet. Add it below");
  await expect(question).toHaveCount(1);
  await expect(page.getByText("Your accounts")).toBeVisible();
  await expect(line).toHaveCount(0);

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(question).toHaveCount(1);
  await expect(line).toBeVisible();
});

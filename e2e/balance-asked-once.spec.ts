import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-16: after uploading a Wells Fargo file (which carries no balance), "What's in Wells
// Fargo checking today?" was asked twice on the page: in the upload's result and in "Your
// accounts". It's asked once; skipped there, the list asks it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

const day = (offset: number) => {
  const d = new Date(Date.now() - offset * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
// A made-up Wells Fargo export: no header row, no balance column.
const statement = () =>
  [
    `"${day(40)}","2100.00","*","","PAYROLL DEPOSIT BRIGHTPATH LABS PPD"`,
    `"${day(30)}","-85.00","*","","T-MOBILE AUTO PAY"`,
    `"${day(26)}","2100.00","*","","PAYROLL DEPOSIT BRIGHTPATH LABS PPD"`,
    `"${day(10)}","-64.20","*","","SAFEWAY #1711 OAKLAND CA"`,
  ].join("\n");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("an upload with no balance asks for it once", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(page.context(), user.sessionToken, baseURL);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Checking1.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(statement()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();

  const question = page.getByRole("group", { name: "What's in Wells Fargo checking today?" });
  await expect(question).toHaveCount(1);
  await expect(page.getByText("Your accounts")).toBeVisible();
  await expect(question).toHaveCount(1);

  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(question).toHaveCount(1);
});

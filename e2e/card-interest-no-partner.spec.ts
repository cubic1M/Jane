import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";

// Debugger 11-16: a student uploaded a Chase card paying interest every month. "Cut your card
// interest" opened /loans/interest, which needs a lending partner no real account has, and said
// only that. It now opens the card interest finding, with its own steps.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(150_000);

const day = (offset: number) => {
  const d = new Date(Date.now() - offset * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

// A made-up Chase card export: purchases, a payment and interest each month.
const statement = () =>
  [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    ...[80, 50, 20].flatMap((offset) => [
      `${day(offset)},${day(offset)},AMAZON MKTPL*XX1234,Shopping,Sale,-64.20,`,
      `${day(offset - 2)},${day(offset - 2)},Payment Thank You-Mobile,,Payment,300.00,`,
      `${day(offset - 5)},${day(offset - 5)},PURCHASE INTEREST CHARGE,Fees & Adjustments,Fee,-42.10,`,
    ]),
  ].join("\n");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("cutting card interest on a real account opens steps, not a dead end", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(page.context(), user.sessionToken, baseURL);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "chase-card.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(statement()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await waitForImport(page, { open: "/loans" });

  await page.goto("/loans/interest");
  await expect(page).toHaveURL(/\/report\/[^/?]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("in interest on Chase card");
  await expect(page.getByRole("button", { name: "Show me how" })).toBeVisible();
  await expect(page.getByText(/lending partner/)).toHaveCount(0);
});

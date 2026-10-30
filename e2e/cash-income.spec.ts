import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// A server who lives on tips (founder, 10-30): cash paid in twice a week counts as income, said
// with how sure Jane is; a one-off cash deposit doesn't; and "Not income" is the person's call.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// Ten weeks of a checking account, ending today: tips in, rent and groceries out.
function statement(): string {
  const rows: string[] = [];
  const day = (back: number) => {
    const d = new Date(Date.now() - back * 86_400_000);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
  };
  const tips = [212.0, 148.5, 305.0, 96.0, 260.25, 181.0, 333.0];
  for (let back = 70, i = 0; back >= 1; back -= back % 7 === 0 ? 4 : 3, i++) {
    rows.push(
      `CREDIT,${day(back)},"ATM CASH DEPOSIT 1234 MAIN ST",${tips[i % tips.length].toFixed(2)},ATM,,,`,
    );
  }
  rows.push(`CREDIT,${day(33)},"BRANCH DEPOSIT",6500.00,DEPOSIT,,,`);
  for (const back of [65, 35, 5])
    rows.push(`DEBIT,${day(back)},"ZELLE TO OAK RIDGE APTS RENT",-1200.00,QUICKPAY_DEBIT,,,`);
  for (let back = 68; back >= 2; back -= 6)
    rows.push(`DEBIT,${day(back)},"SAFEWAY #1234",-64.20,DEBIT_CARD,,,`);
  return ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #", ...rows].join(
    "\n",
  );
}

test("tips deposited in cash count as income, and the person can say they aren't", async ({
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
    name: "chase-checking.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(statement()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page, { open: "/insights" });

  const note = page.locator("[data-cash-income]");
  const readout = page.locator("[data-month-readout]");
  await expect(note).toContainText(/^Cash deposits, counted as income \(\d+% sure\)/);
  await expect(readout).toContainText(/In \$[\d,]+\.\d\d/);
  await expect(page.getByRole("main")).not.toContainText("$0.00");

  await page.goto("/transactions?q=cash");
  await expect(page.getByText("(a cash deposit, counted as income)").first()).toBeVisible();
  // The one-off stays a deposit.
  await page.goto("/transactions?q=branch");
  await expect(page.getByText("(a cash deposit, counted as income)")).toHaveCount(0);

  await page.goto("/insights");
  await note.getByRole("button", { name: "Not income" }).click();
  await expect(note).toContainText("Cash deposits, not counted as income");
  await expect(readout).not.toContainText("In $");

  await note.getByRole("button", { name: "Count as income" }).click();
  await expect(note).toContainText(/counted as income \(\d+% sure\)/);
  await expect(readout).toContainText(/In \$[\d,]+\.\d\d/);
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// One account's statement as a CSV, then as the bank's QFX: only what's new is added, not every
// transaction twice (new-user pass, round 6).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const day = (n: number) => new Date(Date.now() - n * 86_400_000);
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
const ofx = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

test("a QFX after the CSV of the same account adds only what's new", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  const csv = [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    `DEBIT,${us(day(5))},NETFLIX.COM 866-579-7172 CA RECURRING PAYMENT,-15.49,ACH_DEBIT,2484.51,,`,
    `CREDIT,${us(day(6))},INITECH PAYROLL PPD ID 12345,2500.00,ACH_CREDIT,2500.00,,`,
  ].join("\n");
  const qfx =
    "OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><ACCTID>4321<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST>" +
    `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${ofx(day(5))}<TRNAMT>-15.49<FITID>A1<NAME>NETFLIX.COM 866-579-7172 CA RECU</STMTTRN>` +
    `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${ofx(day(6))}<TRNAMT>2500.00<FITID>A2<NAME>INITECH PAYROLL PPD ID 12345</STMTTRN>` +
    `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${ofx(day(2))}<TRNAMT>-6.50<FITID>A3<NAME>BLUE BOTTLE COFFEE</STMTTRN>` +
    "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

  await page.goto("/import");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "Chase.CSV", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: "Import 2 transactions" }).click();
  await waitForImport(page, { open: "/import" });

  // Back on /import, the account choice opens on that account: its QFX into it.
  await input.setInputFiles({
    name: "Chase.QFX",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(qfx),
  });
  await page.getByRole("button", { name: /Preview/ }).click();
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page.locator("[data-import-saved]")).toContainText(/Saved 1 (new )?transaction/);
});

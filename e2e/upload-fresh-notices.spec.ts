import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Right after an upload, a statement ending a few days back isn't "data I'm still checking": a
// bank's export always does, and the person just gave what they had (new-user pass, round 15).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

test("a fresh upload ending ten days back gets no 'import a newer one' notice", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  const day = (n: number) => us(new Date(Date.now() - n * 86_400_000));
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "Chase.CSV",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
        `DEBIT,${day(10)},VERIZON WIRELESS,-85.00,ACH_DEBIT,2415.00,,`,
        `CREDIT,${day(20)},ACME CORP PAYROLL PPD,2500.00,ACH_CREDIT,2500.00,,`,
      ].join("\n"),
    ),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page, { open: "/home" });

  await expect(page.getByRole("heading", { name: "Home" })).toBeAttached();
  await expect(page.getByText(/file ends on/)).toHaveCount(0);
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Taking an upload back (founder: old and new statements shouldn't mix): the upload is listed on
// /import, "Remove this upload" asks first, and once the numbers are worked out again its
// findings and the "found $X/yr" total are gone. Re-uploading is said to be safe.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const usDate = (d: Date) =>
  `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

// Three months of Chase checking with a monthly $12.00 service fee: a finding for sure.
function feesFile(): string {
  const rows: string[] = [];
  let balance = 300000;
  for (let n = 95; n >= 1; n--) {
    const d = new Date(Date.now() - n * 86_400_000);
    if (d.getUTCDate() === 1) {
      balance += 240000;
      rows.push(
        `CREDIT,${usDate(d)},"ACME CORP PAYROLL PPD",2400.00,ACH_CREDIT,${(balance / 100).toFixed(2)},,`,
      );
    }
    if (d.getUTCDate() === 28) {
      balance -= 1200;
      rows.push(
        `DEBIT,${usDate(d)},"MONTHLY SERVICE FEE",-12.00,FEE_TRANSACTION,${(balance / 100).toFixed(2)},,`,
      );
    }
  }
  return [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    ...rows.reverse(),
  ].join("\n");
}

test("an upload can be removed, and its findings go with it", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  await page.goto("/import");
  await expect(page.locator("[data-reupload-safe]")).toContainText(
    "Uploading the same file again, or one that overlaps, is safe",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "fees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(feesFile()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("We found");

  // Listed on /import, with what it added.
  await page.goto("/import");
  const upload = page.locator("[data-upload]").first();
  await expect(upload).toContainText("fees.csv");
  await expect(upload).toContainText("transactions added");

  // It asks first, then removes.
  await upload.getByRole("button", { name: "Remove this upload" }).click();
  await expect(upload.getByText(/^Remove the \d+ transactions this upload added/)).toBeVisible();
  await upload.getByRole("button", { name: "Yes, remove them" }).click();
  await expect(page.locator("[data-import-chip]")).toContainText("up to date", {
    timeout: 120_000,
  });
  await expect(page.locator("[data-upload]")).toHaveCount(0);

  // Its findings and the total are gone.
  await page.goto("/report");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your money report");
  await expect(
    page.getByText("We haven't read any transactions yet.", { exact: false }),
  ).toBeVisible();
});

test("start over deletes every upload, and net worth says there's nothing yet", async ({
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
    name: "fees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(feesFile()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page, { open: "/import" });

  const startOver = page.locator("[data-start-over]");
  await startOver.getByRole("button", { name: "Start over" }).click();
  await expect(startOver).toContainText("This deletes your 1 uploaded account");
  await startOver.getByRole("button", { name: "Yes, delete my uploads" }).click();
  await expect(page.locator("[data-import-chip]")).toContainText("up to date", {
    timeout: 120_000,
  });
  await expect(page.locator("[data-upload]")).toHaveCount(0);

  // No accounts at all: not "$0.00", and not "your files don't include a balance" either.
  await page.goto("/net-worth");
  await expect(page.locator("[data-net-worth-unknown]")).toContainText(
    "No accounts yet. Upload your statements",
  );
  await expect(page.getByText("$0.00")).toHaveCount(0);
});

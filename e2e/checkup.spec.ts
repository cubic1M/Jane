import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Someone who already manages well (founder: what if there's little to save?): the report says
// so with a checkup, one line per check Jane ran with its number, the detail behind a tap, and
// "Not enough data yet" where there's nothing to judge by. Never while Jane is still reading.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(300_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const DAY_MS = 24 * 60 * 60 * 1000;
const usDate = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

// Four months of a Chase checking export ending yesterday: groceries every week (no two alike),
// pay every two weeks, no fees, no subscriptions, cash under three months of spending.
function doingWellCsv(): string {
  const rows: { date: Date; description: string; cents: number; kind: string }[] = [];
  const end = Date.now() - DAY_MS;
  for (let week = 0; week < 17; week += 1) {
    rows.push({
      date: new Date(end - week * 7 * DAY_MS),
      description: "TRADER JOE S #552 OAKLAND CA",
      cents: -(41_000 + week * 137),
      kind: "DEBIT_CARD",
    });
    if (week % 2 === 1) {
      rows.push({
        date: new Date(end - week * 7 * DAY_MS - 2 * DAY_MS),
        description: "ACME CORP PAYROLL PPD ID: 9876543210",
        cents: 200_000,
        kind: "ACH_CREDIT",
      });
    }
  }
  // Newest first, with the running balance, as Chase writes it.
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  let balance = 300_000;
  const lines = rows.map((r) => {
    const line = `${r.cents < 0 ? "DEBIT" : "CREDIT"},${usDate(r.date)},"${r.description}",${(r.cents / 100).toFixed(2)},${r.kind},${(balance / 100).toFixed(2)},,`;
    balance -= r.cents;
    return line;
  });
  return ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #", ...lines].join(
    "\n",
  );
}

test("someone doing well gets a checkup, not just 'nothing to fix'", async ({ page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "chase-checking.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(doingWellCsv()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nothing to fix right now", {
    timeout: 60_000,
  });
  const checkup = page.locator("[data-checkup]");
  await expect(checkup.getByText(/^\d+ of \d+ checks passed$/)).toBeVisible();
  const lines = page.getByRole("list", { name: "Checkup" }).getByRole("listitem");
  await expect(lines.first()).toBeVisible();
  // Nothing found, so no line says found.
  await expect(checkup.locator('[data-check="found"]')).toHaveCount(0);

  // A passed check says its number; the detail opens on a tap.
  const fees = lines.filter({ hasText: "Bank fees" });
  await expect(fees).toHaveAttribute("data-check", "passed");
  await expect(fees).toContainText(/None in \d+ months/);
  await expect(fees.getByText(/^Jane looked at \d+ transactions/)).toBeHidden();
  await fees.getByText("Bank fees").click();
  await expect(fees.getByText(/^Jane looked at \d+ transactions/)).toBeVisible();

  // Nothing to judge by: says so rather than "fine".
  const insurance = lines.filter({ hasText: "Insurance" });
  await expect(insurance).toHaveAttribute("data-check", "not_enough_data");
  await expect(insurance).toContainText("Not enough data yet");
});

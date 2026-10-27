import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// After an upload finishes in the background, the numbers everywhere come from the file
// (founder: "all the other numbers are not updated when I import the CSV", "the graphs are
// flat straight lines"): net worth today and month by month on /net-worth, Home's chart, and
// the money page. A second file changes them again. The person can use Jane while it runs.

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
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

// The last 100 days of Chase checking with its running balance, newest first; ends at $2,000.00.
function checkingFile(): { text: string; endCents: number } {
  const rows: [Date, string, number][] = [];
  for (let n = 100; n >= 1; n--) {
    const d = daysAgo(n);
    if (d.getUTCDate() === 1 || d.getUTCDate() === 15)
      rows.push([d, "ACME CORP PAYROLL PPD", 240000]);
    if (d.getUTCDate() === 2) rows.push([d, "OAKWOOD APTS RENT PAYMENT", -185000]);
    if (d.getUTCDate() === 3) rows.push([d, "NETFLIX.COM NETFLIX.COM CA", -1549]);
    if (n % 3 === 0) rows.push([d, "WHOLEFDS MKT 10234", -5310]);
  }
  const total = rows.reduce((sum, [, , cents]) => sum + cents, 0);
  const endCents = 200000;
  let balance = endCents - total;
  const lines = rows.map(([d, description, cents]) => {
    balance += cents;
    const kind = cents > 0 ? "CREDIT" : "DEBIT";
    return `${kind},${usDate(d)},"${description}",${(cents / 100).toFixed(2)},ACH,${(balance / 100).toFixed(2)},,`;
  });
  return {
    text: [
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
      ...lines.reverse(),
    ].join("\n"),
    endCents,
  };
}

// A card over the same days, with no balance column.
function cardFile(): string {
  const lines = ["Transaction Date,Post Date,Description,Category,Type,Amount,Memo"];
  for (let n = 99; n >= 1; n -= 4) {
    const d = usDate(daysAgo(n));
    lines.push(`${d},${d},UBER   *TRIP,Travel,Sale,-${(14 + (n % 5)).toFixed(2)},`);
  }
  return lines.join("\n");
}

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

async function upload(page: Page, name: string, text: string, fields: Record<string, string>) {
  await page.goto("/import");
  await page.locator('select[name="accountId"]').selectOption("new");
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("button", { name: /^Import \d+ transactions?$/ })).toBeVisible();
  for (const [field, value] of Object.entries(fields)) {
    await page.locator(`[name="${field}"]`).fill(value);
  }
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
}

// The net worth card's amount, and the distinct amounts in the month-by-month list.
async function netWorthPage(page: Page) {
  await page.goto("/net-worth");
  const card = page
    .locator("section div")
    .filter({ hasText: /^Net worth/ })
    .first();
  const today = ((await card.textContent()) ?? "").replace(/^Net worth/, "").trim();
  const months = await page
    .locator("h2:has-text('Month by month') + ul li span:last-child")
    .allTextContents();
  return { today, distinct: new Set(months.map((m) => m.trim()).filter(Boolean)).size };
}

test("an upload's numbers reach net worth, Home and the money page; a second file moves them", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  const checking = checkingFile();
  await upload(page, "checking.csv", checking.text, { "new.name": "Everyday checking" });
  // Saved at once; the person can go elsewhere while the rest runs.
  await expect(page.locator("[data-import-saved]")).toContainText("Saved");
  await page.getByRole("link", { name: "Go to Home" }).click();
  await expect(page).toHaveURL("/home");
  // The chip follows it on any page, and says when it's done.
  await expect(page.locator("[data-import-chip]")).toBeVisible();
  await expect(page.locator('[data-import-chip="done"]')).toContainText("Done", {
    timeout: 120_000,
  });

  // Net worth today is the statement's last balance, and the months before differ.
  const first = await netWorthPage(page);
  expect(first.today).toBe(dollars(checking.endCents));
  expect(first.distinct).toBeGreaterThan(1);

  // Home's chart: the same number, and it moved.
  await page.goto("/home");
  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart.locator('[data-hub-number="net-worth"]')).toHaveText(
    dollars(checking.endCents).replace(/\.\d\d$/, ""),
  );
  await expect(chart.locator("[data-net-worth-change]")).not.toContainText("$0 ");

  // The money page fills in from the file, with no "link a bank" empty state.
  await page.goto("/money");
  await expect(page.getByText("Link a bank to fill this in")).toHaveCount(0);
  // Its tree's branches fill in from the file (folded on a phone, so by their names).
  await expect(page.getByRole("treeitem", { name: /Where it goes/ })).toBeVisible();

  // A card with $350.00 owed: net worth goes down by that.
  // Its layout says it's a card: the new account's type is suggested as one.
  await upload(page, "card.csv", cardFile(), {
    "new.name": "Travel card",
    "new.balance": "350.00",
  });
  await waitForImport(page, { open: "/net-worth" });
  const second = await netWorthPage(page);
  expect(second.today).toBe(dollars(checking.endCents - 35000));
});

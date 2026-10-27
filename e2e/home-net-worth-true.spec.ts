import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Home's net worth after real-looking uploads (founder: "the main networth is still broken… the
// graph doesn't correspond… doesn't show every single movement of the money, and can't click on
// them"). A checking account's months come oldest first, then a card whose balance is given: the
// headline is the newest checking balance less the card, the line ends there, and each day money
// moved is a dot that says that day's net worth and leads to its transactions.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(300_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

// Chase checking from $1,000.00: [days ago, description, cents]. Ends at $6,030.00.
const ROWS: [number, string, number][] = [
  [100, "ACME CORP PAYROLL PPD", 200_000],
  [90, "ZELLE TO LANDLORD", -140_000],
  [70, "ACME CORP PAYROLL PPD", 200_000],
  [65, "VERIZON WIRELESS", -8_500],
  [55, "ZELLE TO LANDLORD", -140_000],
  [40, "ACME CORP PAYROLL PPD", 200_000],
  [20, "VERIZON WIRELESS", -8_500],
  [5, "ACME CORP PAYROLL PPD", 200_000],
];

function checking(from: number, to: number): string {
  let bal = 100_000;
  const lines: string[] = [];
  for (const [n, desc, cents] of ROWS) {
    bal += cents;
    if (n <= from && n >= to) {
      const kind = cents < 0 ? "DEBIT" : "CREDIT";
      lines.unshift(
        `${kind},${us(ago(n))},"${desc}",${(cents / 100).toFixed(2)},ACH,${(bal / 100).toFixed(2)},,`,
      );
    }
  }
  return ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #", ...lines].join(
    "\n",
  );
}

function card(): string {
  return [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    `${us(ago(10))},${us(ago(10))},UBER   *TRIP,Travel,Sale,-45.00,`,
    `${us(ago(30))},${us(ago(30))},WHOLEFDS MKT 10234,Groceries,Sale,-80.00,`,
  ].join("\n");
}

test("the headline is the newest balances' sum, the line ends there, and a day's dot opens", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  const select = page.locator('select[name="accountId"]');
  const upload = async (name: string, text: string, account?: "new") => {
    if (account) await select.selectOption(account);
    await page.locator('input[type="file"]').setInputFiles({
      name,
      mimeType: "text/csv",
      buffer: Buffer.from(text),
    });
    await page.getByRole("button", { name: /Preview/ }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
    await waitForImport(page, { open: "/import" });
  };

  await page.goto("/import");
  // Oldest first, as people often do: the older months, then the newer into the same account.
  await upload("Chase_older.CSV", checking(100, 61), "new");
  await expect(select.locator("option:checked")).toContainText("Chase checking");
  await upload("Chase_newer.CSV", checking(60, 1));
  await upload("Chase_card.CSV", card(), "new");
  // The card's balance, given.
  const ask = page.locator("[data-uploaded-account] [data-balance-ask]");
  await ask.getByRole("textbox").fill("300.00");
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-import-chip="done"]')).toContainText("up to date", {
    timeout: 120_000,
  });

  // $6,030.00 in checking less $300.00 owed on the card.
  await page.goto("/home");
  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart.locator('[data-hub-number="net-worth"]')).toHaveText("$5,730");
  // The line's last point is the headline.
  await expect(chart.locator("[data-net-worth-plot]")).toHaveAttribute(
    "aria-valuetext",
    "Today: $5,730",
  );

  // Every day money moved is a dot, without expanding; the last one opens with that day's net
  // worth and a way to its transactions.
  const dots = chart.locator("[data-net-worth-dots]");
  await expect(dots).toBeVisible({ timeout: 30_000 });
  await dots.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const card5 = chart.locator("[data-net-worth-event-card]");
  await expect(card5).toBeVisible();
  await expect(card5.locator("[data-net-worth-day-worth]")).toHaveText("Net worth then: $5,730");
  await card5.getByRole("link", { name: "See that day's transactions" }).click();
  await expect(page).toHaveURL(/\/transactions\?day=\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator("[data-transactions-days]")).toContainText("On ");
  await expect(page.getByText("ACME CORP PAYROLL", { exact: false }).first()).toBeVisible();
});

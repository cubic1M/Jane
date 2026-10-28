import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Net worth below zero, read off the chart (QA round 31: a card-only person's line, all below
// zero, read as dipping under $0 and spiking above it against the dashed start line). The chart
// says what its heights are worth: the highest and lowest in view, and $0 when the line crosses it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(300_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const FIXTURES = "src/data-sources/csv/__fixtures__";
const pad = (n: number) => String(n).padStart(2, "0");
const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

async function upload(page: Page, file: string | { name: string; text: string }) {
  await page.goto("/import");
  await page.locator('select[name="accountId"]').selectOption("new");
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      typeof file === "string"
        ? `${FIXTURES}/${file}`
        : { name: file.name, mimeType: "text/csv", buffer: Buffer.from(file.text) },
    );
  await page.getByRole("button", { name: /Preview/ }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await waitForImport(page, { open: "/import" });
}

async function owe(page: Page, amount: string) {
  const ask = page.locator("[data-uploaded-account] [data-balance-ask]").filter({ hasText: "owe" });
  await ask.getByRole("textbox").fill(amount);
  await ask.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('[data-import-chip="done"]')).toContainText("up to date", {
    timeout: 120_000,
  });
}

test("a card-only net worth stays below zero on the chart, and says so", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  // The Citi card: $1,321.88 owed at the end of August, a $500 payment on Sep 20, $900 now.
  await upload(page, "citi-credit-card.csv");
  await owe(page, "900.00");

  await page.goto("/home");
  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart.locator('[data-hub-number="net-worth"]')).toHaveText("-$900");
  await expect(chart.locator("[data-net-worth-plot]")).toHaveAttribute(
    "aria-valuetext",
    "Today: -$900",
  );
  // Its scale: everything below zero, no $0 line to cross.
  await expect(chart.locator('[data-net-worth-scale="high"]')).toHaveText("-$832");
  await expect(chart.locator('[data-net-worth-scale="low"]')).toHaveText("-$1,352");
  await expect(chart.locator("[data-net-worth-zero]")).toHaveCount(0);
});

test("a net worth that crosses zero draws $0 between its low and high", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  // Checking from $500.00, $2,000.00 pay 20 days ago: $2,500.00 now.
  await upload(page, {
    name: "Chase.CSV",
    text: [
      "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
      `CREDIT,${us(ago(20))},"ACME CORP PAYROLL PPD",2000.00,ACH_CREDIT,2500.00,,`,
      `DEBIT,${us(ago(40))},"VERIZON WIRELESS",-85.00,ACH_DEBIT,500.00,,`,
    ].join("\n"),
  });
  // A card with $1,000.00 owed: net worth below zero before the pay, above after.
  await upload(page, "citi-credit-card.csv");
  await owe(page, "1000.00");

  await page.goto("/home");
  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart.locator('[data-hub-number="net-worth"]')).toHaveText("$1,500");
  await expect(chart.locator("[data-net-worth-zero]")).toHaveCount(1);
  await expect(chart.locator('[data-net-worth-scale="zero"]')).toHaveText("$0");
  await expect(chart.locator('[data-net-worth-scale="high"]')).toHaveText(/^\$[\d,]+$/);
  await expect(chart.locator('[data-net-worth-scale="low"]')).toHaveText(/^-\$[\d,]+$/);
  // $0 sits between them.
  await chart.scrollIntoViewIfNeeded();
  const tops = await chart.evaluate((el) =>
    Object.fromEntries(
      ["high", "zero", "low"].map((s) => [
        s,
        el.querySelector(`[data-net-worth-scale="${s}"]`)!.getBoundingClientRect().top,
      ]),
    ),
  );
  expect(tops.high).toBeLessThan(tops.zero);
  expect(tops.zero).toBeLessThan(tops.low);
});

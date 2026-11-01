import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Where your money goes (founder, 10-29: "for each section, you can expand and see the specific
// transactions. The graph is also uninteractive, doesn't show any numbers at all."). On the
// demo bank: a row opens to its transactions, a month shows its numbers, a click switches the
// breakdown. Runs on desktop and phone (playwright.config.ts projects).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const dollars = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);
const signedCents = (text: string) => (text.includes("−") ? -1 : 1) * dollars(text);

test("rows open to their transactions and the month chart shows and picks months", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Where your money goes" })).toBeVisible();

  // Every category row opens at once to transactions that add up to its total.
  const categories = page.getByRole("list", { name: "Categories" });
  const first = categories.getByRole("button").first();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  const rowTotal = dollars(
    (await first.locator("span.tabular-nums .font-medium").innerText()).trim(),
  );
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const lines = categories.locator("[data-lines]").first();
  await expect(lines.getByRole("listitem").first()).toBeVisible();
  const showAll = categories.getByRole("button", { name: /^Show all \d+$/ });
  if (await showAll.count()) await showAll.first().click();
  const amounts = await lines.locator("li > span.tabular-nums").allInnerTexts();
  expect(amounts.reduce((sum, a) => sum + signedCents(a), 0)).toBe(rowTotal);
  await expect(categories.getByRole("link", { name: "In Transactions" })).toHaveAttribute(
    "href",
    /\/transactions\?category=[A-Z_]+&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/,
  );

  // A merchant row opens too.
  const merchants = page.getByRole("list", { name: "Merchants" });
  await merchants.getByRole("button").first().click();
  await expect(merchants.locator("[data-lines] li").first()).toBeVisible();

  // The chart has dollars on its axis, and a month's numbers on hover or tap.
  const chart = page.getByRole("group", { name: "Income and spending by month" });
  await expect(page.getByText(/^\$\d+(\.\d)?k$/).first()).toBeVisible();
  const readout = page.locator("[data-month-readout]");
  await expect(readout).toContainText(/In \$[\d,]+\.\d\d/);
  await expect(readout).toContainText(/Out \$[\d,]+\.\d\d/);
  await expect(readout).toContainText(/Net [+−]\$[\d,]+\.\d\d/);

  const heading = page.locator("[data-breakdown-month]");
  const before = await heading.getAttribute("data-breakdown-month");
  // Another month that had spending.
  const months = chart.getByRole("button");
  const count = await months.count();
  let other: string | null = null;
  // Not the one shown: on the 1st the newest bar is empty and the breakdown already shows the
  // month before it (debugger 11-01).
  for (let i = count - 1; i >= 0; i--) {
    const label = (await months.nth(i).getAttribute("aria-label")) ?? "";
    const month = await months.nth(i).getAttribute("data-month");
    if (!/out \$0\.00$/.test(label) && month !== before) {
      other = month;
      break;
    }
  }
  expect(other).not.toBeNull();
  const target = chart.locator(`[data-month="${other}"]`);
  await target.hover();
  const monthName = new Date(`${other}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  await expect(readout).toContainText(monthName);

  // A click (or tap) switches the breakdown to that month; the readout keeps its numbers.
  await target.click();
  await expect(heading).toHaveAttribute("data-breakdown-month", other!);
  expect(other).not.toBe(before);
  await expect(heading).toContainText(monthName);
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(categories.getByRole("button", { expanded: true })).toHaveCount(0);

  // The keyboard moves between months, and Enter picks one.
  await target.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(heading).not.toHaveAttribute("data-breakdown-month", other!);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

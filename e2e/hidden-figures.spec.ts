import { expect, test } from "@playwright/test";
import { openHomeMore } from "./home-more";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Home's big figures start hidden (founder 11-04: "start off with all the big ones blinded, since
// ppl don't like to show their networth in public"), each with a way to show it right beside it.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("every big figure starts hidden, shows on its own, and is hidden again on the next visit", async ({
  page,
  context,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  // Home's one big figure is net worth (home redesign 11-12); Safe to spend is on Spending &
  // bills, below.
  const chart = page.locator("[data-net-worth-chart]");
  const netWorth = chart.locator('[data-hub-number="net-worth"]');
  const dollars = /\$/;

  await expect(netWorth).toContainText("*****");
  await expect(netWorth).not.toContainText(dollars);
  // Nothing on the chart gives the figure away: no scale, no dollars moved, none read out.
  await expect(chart.locator("[data-net-worth-scale]")).toHaveCount(0);
  await expect(chart.locator("[data-net-worth-change]")).not.toContainText(dollars);
  await expect(chart.locator("[data-net-worth-plot]")).toHaveAttribute(
    "aria-valuetext",
    "Today: hidden",
  );
  // Nor do the area tiles: an amount waits for its tile to open.
  await openHomeMore(page);
  const tree = page.locator("[data-giant-tree]");
  await expect(tree).toBeVisible({ timeout: 60_000 });
  const tiles = tree.locator("[data-giant-area-tile]");
  await expect(tiles.first()).toBeVisible();
  for (const tile of await tiles.all()) await expect(tile).not.toContainText(dollars);
  const loans = tree.locator('[data-giant-area-tile="loans"]');
  await expect(loans).toContainText("*****");
  await loans.click();
  await expect(loans).toContainText(dollars);

  // The way to show it sits right beside the stars, on the same line.
  const show = chart.getByRole("button", { name: /SHOW VALUE.* of net worth/ });
  const [figureBox, showBox] = [(await netWorth.boundingBox())!, (await show.boundingBox())!];
  expect(showBox.x).toBeGreaterThanOrEqual(figureBox.x + figureBox.width);
  expect(showBox.y).toBeLessThan(figureBox.y + figureBox.height);

  // Shown: that figure and its scale.
  await show.click();
  await expect(netWorth).toHaveText(/^-?\$[\d,]+$/);
  await expect(chart.locator('[data-net-worth-scale="high"]')).toBeVisible();
  await expect(chart.locator("[data-net-worth-change]")).toContainText(dollars);

  // Hidden again with the same button.
  await chart.getByRole("button", { name: /HIDE VALUE.* of net worth/ }).click();
  await expect(netWorth).toContainText("*****");
  await expect(chart.locator("[data-net-worth-scale]")).toHaveCount(0);

  // Never remembered: the next visit starts hidden.
  await chart.getByRole("button", { name: /SHOW VALUE.* of net worth/ }).click();
  await expect(netWorth).toHaveText(/^-?\$[\d,]+$/);
  await page.reload();
  await expect(netWorth).toContainText("*****");

  // Safe to spend, on Spending & bills: hidden too. Asking why this number is asking to see it;
  // hiding it shuts the why.
  await page.goto("/money");
  const safe = page.locator('[data-hub-number="safe"]');
  await expect(safe).toContainText("*****", { timeout: 60_000 });
  const safeTile = page.locator('[data-hub-tile="safe"]');
  const why = safeTile.getByRole("button", { name: /why this number/ });
  await why.click();
  await expect(safe).toHaveText(/\$[\d,]+/);
  await safeTile.locator("[data-show-value]").click();
  await expect(safe).toContainText("*****");
  await expect(why).toHaveAttribute("aria-expanded", "false");
});

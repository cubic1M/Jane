import { expect, test } from "@playwright/test";
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

  const chart = page.locator("[data-net-worth-chart]");
  const netWorth = chart.locator('[data-hub-number="net-worth"]');
  const safe = page.locator('[data-hub-number="safe"]');
  const saved = page.locator('[data-hub-number="saved"]');
  const dollars = /\$/;

  for (const figure of [netWorth, safe, saved]) {
    await expect(figure).toContainText("*****");
    await expect(figure).not.toContainText(dollars);
  }
  // Nothing on the chart gives the figure away: no scale, no dollars moved, none read out.
  await expect(chart.locator("[data-net-worth-scale]")).toHaveCount(0);
  await expect(chart.locator("[data-net-worth-change]")).not.toContainText(dollars);
  await expect(chart.locator("[data-net-worth-plot]")).toHaveAttribute(
    "aria-valuetext",
    "Today: hidden",
  );
  // Nor do the area tiles: an amount waits for its tile to open.
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

  // Shown: that figure and its scale, and no other figure.
  await show.click();
  await expect(netWorth).toHaveText(/^-?\$[\d,]+$/);
  await expect(chart.locator('[data-net-worth-scale="high"]')).toBeVisible();
  await expect(chart.locator("[data-net-worth-change]")).toContainText(dollars);
  await expect(safe).toContainText("*****");
  await expect(saved).toContainText("*****");

  // Hidden again with the same button.
  await chart.getByRole("button", { name: /HIDE VALUE.* of net worth/ }).click();
  await expect(netWorth).toContainText("*****");
  await expect(chart.locator("[data-net-worth-scale]")).toHaveCount(0);

  // Asking why this number is asking to see it; hiding it shuts the why.
  const safeTile = page.locator('[data-hub-tile="safe"]');
  const why = safeTile.getByRole("button", { name: "Why this number" });
  await why.click();
  await expect(safe).toHaveText(/\$[\d,]+/);
  await safeTile.locator("[data-show-value]").click();
  await expect(safe).toContainText("*****");
  await expect(safeTile.getByRole("button", { name: "Why this number" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Never remembered: the next visit starts hidden.
  await chart.getByRole("button", { name: /SHOW VALUE.* of net worth/ }).click();
  await expect(netWorth).toHaveText(/^-?\$[\d,]+$/);
  await page.reload();
  await expect(netWorth).toContainText("*****");
});

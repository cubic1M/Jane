import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The home hub (docs/design/home-hub.md): graphs first and few words. Three numbers up top,
// the next 30 days on a line you can step along, and a tile per area with its health, one
// number and a tiny chart, each opening its tab. On a computer the chat is docked beside it;
// on a phone nothing scrolls sideways.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const AREAS = [
  "Spending & bills",
  "Insurance",
  "Loans & credit",
  "Taxes",
  "Investing (practice)",
  "Plans & goals",
];

test("the hub shows the money at a glance, the month ahead and every area", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeAttached();

  // The hero row: safe to spend with its bar, net worth, and money found or saved.
  const hero = page.getByRole("region", { name: "Your money at a glance" });
  await expect(hero.locator("[data-hub-number]")).toHaveCount(3);
  await expect(hero.getByRole("link", { name: /^Safe to spend/ })).toBeVisible();
  await expect(hero.getByRole("img", { name: /Safe to spend \d+%/ })).toBeVisible();
  await expect(hero.getByRole("link", { name: "Net worth" })).toHaveAttribute("href", "/net-worth");

  // The month ahead: one tab stop, the arrow keys step along it, each mark says what it is.
  const strip = page.getByRole("group", { name: /^Next 30 days:/ });
  const marks = strip.getByRole("button");
  expect(await marks.count()).toBeGreaterThan(1);
  await expect(strip.locator('button[tabindex="0"]')).toHaveCount(1);
  await marks.first().focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  const first = await page.getByRole("tooltip").textContent();
  await page.keyboard.press("ArrowRight");
  await expect(marks.nth(1)).toBeFocused();
  await expect(page.getByRole("tooltip")).not.toHaveText(first ?? "");
  await expect(marks.nth(1)).toHaveAccessibleName(/, (bill|payday|date), [A-Z][a-z]{2} \d+/);

  // A tile per area, in tab order, each with a health word or what to set up, and a chart.
  const tiles = page.getByRole("region", { name: "Your areas" }).getByRole("listitem");
  await expect(tiles).toHaveCount(6);
  for (const [i, name] of AREAS.entries()) {
    await expect(tiles.nth(i).getByRole("link").first()).toHaveText(name);
    await expect(tiles.nth(i)).toContainText(/Good|Look|Act|Not set up/);
  }
  await expect(page.locator("[data-health]").first()).toBeVisible();
  // Few numbers: three up top and at most one per tile.
  const tileNumbers = await tiles.locator("p.text-2xl").count();
  expect(tileNumbers).toBeLessThanOrEqual(6);

  // On a computer the chat is docked beside the hub; on a phone nothing scrolls sideways.
  if (!isMobile) {
    await expect(page.getByRole("complementary", { name: "Chat with Jane" })).toBeVisible();
  } else {
    await expect(page.getByRole("button", { name: /^Chat with Jane/ })).toBeVisible();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // A tile opens its tab.
  await tiles.nth(1).getByRole("link", { name: "Insurance" }).click();
  await expect(page).toHaveURL("/insurance");
});

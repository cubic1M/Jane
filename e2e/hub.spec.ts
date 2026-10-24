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
  // One event: "Rent, bill, Nov 1, $1,200.00"; a day's events of one kind are one mark that
  // lists them: "2 bills, Nov 1: Rent $1,200.00; Phone $80.00".
  await expect(marks.nth(1)).toHaveAccessibleName(
    /, (bill|payday|date), [A-Z][a-z]{2} \d+|^\d+ (bill|payday|date)s, [A-Z][a-z]{2} \d+: /,
  );
  // No two marks on the same spot: each can be tapped (tap audit).
  const spots = await marks.evaluateAll((els) =>
    els.map((el) => `${el.getAttribute("data-kind")}|${(el as HTMLElement).style.left}`),
  );
  expect(new Set(spots).size).toBe(spots.length);

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

test("the areas are fixed tiles that each open into their tree, and a feature's Ask Jane box sends to the chat", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  // Six fixed tiles: no Jane box above them, nothing to drag or zoom.
  const tree = page.locator("[data-giant-tree]");
  const tiles = tree.locator("[data-giant-area-tile]");
  await expect(tiles).toHaveCount(AREAS.length, { timeout: 60_000 });
  // Streamed in: on screen, not still in the page's hidden placeholder.
  await expect(tiles.last()).toBeVisible();
  for (const [i, name] of AREAS.entries()) await expect(tiles.nth(i)).toContainText(name);
  await expect(tree.getByText(/^> ?Jane$/)).toHaveCount(0);
  for (const name of ["Zoom in", "Zoom out", "Fit the whole tree"]) {
    await expect(tree.getByRole("button", { name })).toHaveCount(0);
  }
  // A row of six on a computer; two by three on a phone.
  const tops = await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  const rows = new Set(tops.map((t) => Math.round(t))).size;
  expect(rows).toBe(isMobile ? 3 : 1);
  // Every name in full: wrapped, never cut with "…".
  await tiles.first().scrollIntoViewIfNeeded();
  for (const text of await tiles.allTextContents()) expect(text).not.toContain("…");

  // A tile opens its tree below the row: the area, its branches, their features.
  const taxes = tree.locator('[data-giant-area-tile="taxes"]');
  await expect(taxes).toHaveAttribute("aria-expanded", "false");
  await taxes.click();
  await expect(taxes).toHaveAttribute("aria-expanded", "true");
  const area = tree.locator('[data-giant-area="taxes"]');
  await expect(area).toBeVisible();
  expect(await area.locator("[data-giant-branch]").count()).toBeGreaterThan(2);
  expect(await area.locator("[data-giant-feature]").count()).toBeGreaterThan(6);
  const tilesBottom = Math.max(
    ...(await tiles.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom))),
  );
  expect((await area.boundingBox())!.y).toBeGreaterThanOrEqual(tilesBottom - 1);
  // It fits the width: nothing sideways.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  for (const text of await area.allTextContents()) expect(text).not.toContain("…");
  // Another tile swaps the tree; the same one again shuts it.
  await tree.locator('[data-giant-area-tile="insurance"]').click();
  await expect(tree.locator('[data-giant-area="insurance"]')).toBeVisible();
  await expect(area).toHaveCount(0);
  await tree.locator('[data-giant-area-tile="insurance"]').click();
  await expect(tree.locator("[data-giant-area]")).toHaveCount(0);
  await taxes.click();

  // A feature opens in place: what it is, [OPEN], and its Ask Jane box.
  const feature = area.locator("[data-giant-feature]").first();
  const toggle = feature.getByRole("button").first();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const detail = feature.locator("[data-giant-detail]");
  await expect(detail.getByRole("link", { name: "[OPEN]" })).toBeVisible();

  // Its Ask Jane box sends the question straight into the chat: no Send to press.
  const ask = detail.locator("[data-ask-jane]");
  await expect(ask).toBeVisible();
  const question = ((await ask.locator(":scope > span").last().textContent()) ?? "").trim();
  expect(question.length).toBeGreaterThan(5);
  await ask.click();
  if (isMobile) {
    await expect(page.getByRole("dialog", { name: "Chat with Jane" })).toBeVisible();
  }
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  const messages = chat.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(chat.getByText(question).first()).toBeVisible({ timeout: 30_000 });
  // Jane answers, and the box says it was asked; asked again, it doesn't send twice.
  await expect(ask).toContainText("ASKED", { timeout: 60_000 });
  const count = await messages.count();
  // On a phone the sheet is over the page: close it to reach the box again.
  if (isMobile) await page.getByRole("button", { name: "Close chat" }).click();
  await ask.click();
  await page.waitForTimeout(1000);
  expect(await messages.count()).toBe(count);
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The home hub's net worth chart (founder request: "a graph similar to Robinhood that displays
// your total net worth from beginning of using Jane to present"). A big number with the
// range's change, one line from the first day to today, range chips (ALL first), and
// scrubbing: hover on a computer, drag on a phone, the arrow keys anywhere; letting go returns
// to today.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the net worth chart scrubs, changes range and returns to today", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart).toBeVisible();
  const number = chart.locator('[data-hub-number="net-worth"]');
  const change = chart.locator("[data-net-worth-change]");
  const today = (await number.textContent()) ?? "";
  expect(today).toMatch(/^-?\$[\d,]+$/);
  // ALL is chosen first, and runs from the sample person's first day (a year of balances).
  const ranges = chart.getByRole("group", { name: "Range" });
  await expect(ranges.getByRole("button", { name: /^ALL/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(change).toContainText(/^[+−]\$[\d,]+ \([+−][\d.]+%\) Since you started$/);
  await expect(ranges.getByRole("button", { name: /^1W/ })).toBeVisible();

  // A shorter range: its own change.
  await ranges.getByRole("button", { name: /^1M/ }).click();
  await expect(ranges.getByRole("button", { name: /^1M/ })).toHaveAttribute("aria-pressed", "true");
  await expect(change).toContainText("Past month");
  await expect(number).toHaveText(today);
  await ranges.getByRole("button", { name: /^ALL/ }).click();

  // Scrub to the start of the line: the number and the date follow, then back to today.
  const line = chart.getByRole("slider", { name: /^Net worth/ });
  const box = (await line.boundingBox())!;
  const y = box.y + box.height / 2;
  if (isMobile) {
    // A finger drag, as the phone sends it.
    await line.dispatchEvent("pointerdown", {
      pointerType: "touch",
      pointerId: 7,
      clientX: box.x + box.width / 2,
      clientY: y,
    });
    await line.dispatchEvent("pointermove", {
      pointerType: "touch",
      pointerId: 7,
      clientX: box.x + 4,
      clientY: y,
    });
  } else {
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.move(box.x + 4, y, { steps: 4 });
  }
  await expect(change).toContainText(/[A-Z][a-z]{2} \d+, \d{4}$/);
  await expect(line).not.toHaveAttribute("aria-valuetext", /^Today/);
  if (isMobile) {
    await line.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 7 });
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y - 60);
  }
  await expect(number).toHaveText(today);
  await expect(change).toContainText("Since you started");

  // The keyboard: Left steps back a day, End (or Escape) returns to today.
  await line.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(line).toHaveAttribute("aria-valuetext", /^[A-Z][a-z]{2} \d+, \d{4}: /);
  await page.keyboard.press("End");
  await expect(line).toHaveAttribute("aria-valuetext", `Today: ${today}`);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("expanded, the chart marks what moved the money, each with its card", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  const chart = page.locator("[data-net-worth-chart]");
  await expect(chart).toBeVisible();
  // No markers until it's expanded: the hero stays a clean line.
  await expect(chart.locator("[data-net-worth-event]")).toHaveCount(0);
  const expand = chart.getByRole("button", { name: /EXPAND/ });
  await expand.click();
  await expect(chart.getByRole("button", { name: /CLOSE/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  // A sample person's year has paydays, bills and purchases: a handful of days, never a crowd.
  const marks = chart.locator("[data-net-worth-event]");
  await expect(marks.first()).toBeVisible();
  const count = await marks.count();
  expect(count).toBeGreaterThan(2);
  expect(count).toBeLessThanOrEqual(12);

  // Its card: the date, what happened and ± how much, linked to where to see it.
  const first = marks.first();
  await expect(first).toHaveAttribute("aria-label", /^[A-Z][a-z]{2} \d{1,2}, \d{4}: .+/);
  await first.focus();
  const card = chart.locator("[data-net-worth-event-card]");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d{4}/);
  await expect(card.getByRole("link").first()).toHaveAttribute(
    "href",
    /^\/(transactions|loans|investments|actions)/,
  );
  await expect(card).toContainText(/[+−]\$[\d,]+|\$[\d,]+ moved/);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);

  // A shorter range marks only its own days.
  await chart.getByRole("group", { name: "Range" }).getByRole("button", { name: /^1M/ }).click();
  expect(await marks.count()).toBeLessThanOrEqual(count);
});

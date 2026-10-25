import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// The home hub's net worth chart (founder request: "a graph similar to Robinhood that displays
// your total net worth from beginning of using Jane to present"). A big number with the
// range's change, one line from the first day to today, range chips (ALL first), and
// scrubbing: hover on a computer, drag on a phone, the arrow keys anywhere; letting go returns
// to today.

// On a phone More details is a sheet along the bottom of the screen, all of it in view (QA
// round 9: in the chart it ran off the screen, under the chat's button).
async function expectSheet(page: Page, details: Locator) {
  await expect(details).toHaveAttribute("data-sheet-details", "");
  await expect(details).toBeInViewport({ ratio: 1 });
  const box = (await details.boundingBox())!;
  const screen = page.viewportSize()!;
  expect(box.x).toBeLessThanOrEqual(1);
  expect(box.width).toBeGreaterThanOrEqual(screen.width - 2);
  expect(Math.abs(box.y + box.height - screen.height)).toBeLessThanOrEqual(2);
}

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
  await expect(change).toContainText(/^[▲▼] [+−]\$[\d,]+ \([+−][\d.]+%\) Since you started$/);
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

test("the significant days open where the money went, inside the chart", async ({
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
  // Collapsed, only the significant days have dots, so the hero stays clean: a sample person's
  // year has paydays, bills and purchases, a handful of days, never a crowd.
  const marks = chart.locator("[data-net-worth-event]");
  await expect(marks.first()).toBeVisible();
  const count = await marks.count();
  expect(count).toBeGreaterThan(2);
  expect(count).toBeLessThanOrEqual(12);

  // A click opens the day's summary inside the chart: the date, and a line each for what moved
  // the money ("−$1,640 · card payment · Chase ····5003").
  const first = marks.first();
  await expect(first).toHaveAttribute("aria-label", /^[A-Z][a-z]{2} \d{1,2}, \d{4}: .+/);
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const card = chart.locator("[data-net-worth-event-card]");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d{4}/);
  await expect(card.getByRole("listitem").first()).toHaveText(
    /^([+−]\$[\d,]+|\$[\d,]+ moved) · .+/,
  );

  // More details: the full breakdown beside it, joined by a dotted line (on a phone a sheet from
  // the bottom of the screen), every movement linked to where to see it.
  await card.getByRole("button", { name: "[MORE DETAILS]" }).click();
  const details = page.locator("[data-net-worth-event-detail]");
  await expect(details).toBeVisible();
  await expect(details.getByRole("link").first()).toHaveAttribute(
    "href",
    /^\/(transactions|loans|investments|actions)/,
  );
  await expect(details).toContainText("That day");
  const area = (await chart.boundingBox())!;
  if (isMobile) {
    await expectSheet(page, details);
  } else {
    await expect(chart.locator("[data-net-worth-connector]")).toBeAttached();
    // Both stay inside the chart: nothing outside it is covered.
    for (const box of [await card.boundingBox(), await details.boundingBox()]) {
      expect(box!.x).toBeGreaterThanOrEqual(area.x - 1);
      expect(box!.y).toBeGreaterThanOrEqual(area.y - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(area.x + area.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(area.y + area.height + 1);
    }
  }
  // Esc shuts both and returns to the dot; a click outside shuts them too.
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(details).toHaveCount(0);
  await expect(first).toBeFocused();
  await first.click();
  await expect(card).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Home" }).click({ force: true });
  await expect(card).toHaveCount(0);

  // A shorter range marks only its own days.
  await chart.getByRole("group", { name: "Range" }).getByRole("button", { name: /^1M/ }).click();
  expect(await marks.count()).toBeLessThanOrEqual(count);
});

test("expanded, every movement has a dot, and zooming in gives each its own", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  const chart = page.locator("[data-net-worth-chart]");
  await chart.getByRole("button", { name: /EXPAND/ }).click();
  // Every movement in cash: far more than the significant days, overlapping ones drawn as one.
  const dots = chart.locator("[data-net-worth-dots]");
  await expect(dots).toBeAttached({ timeout: 30_000 });
  const all = Number(await dots.getAttribute("data-movements"));
  expect(all).toBeGreaterThan(50);
  expect(Number(await dots.getAttribute("data-dots"))).toBeLessThanOrEqual(all);
  await expect(chart.locator("[data-net-worth-event]")).toHaveCount(0);

  // Zoomed in as far as it goes (the brush's [+], all in the chart's own area), every
  // movement in view is its own dot.
  const zoomIn = chart.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 12; i++) await zoomIn.click();
  await expect(chart.getByRole("slider", { name: "Days in view" })).toHaveAttribute(
    "aria-valuetext",
    /^[A-Z][a-z]{2} \d{1,2}, \d{4} to [A-Z][a-z]{2} \d{1,2}, \d{4}$/,
  );
  // Back to a day with movements: the brush moves the window along.
  const brush = chart.getByRole("slider", { name: "Days in view" });
  for (let i = 0; i < 40 && Number(await dots.getAttribute("data-movements")) === 0; i++) {
    await brush.focus();
    await page.keyboard.press("ArrowLeft");
  }
  const inView = Number(await dots.getAttribute("data-movements"));
  expect(inView).toBeGreaterThan(0);
  await expect(dots).toHaveAttribute("data-dots", String(inView));

  // The arrow keys move between the dots and Enter opens the one they're on: its box says the
  // same movement the keys announced.
  await dots.focus();
  await page.keyboard.press("ArrowRight");
  const said = (await chart.locator('p[aria-live="polite"]').textContent()) ?? "";
  const line = said.split(": ").slice(1).join(": ");
  await page.keyboard.press("Enter");
  const card = chart.locator("[data-net-worth-event-card]");
  await expect(card).toBeVisible();
  await expect(card.getByRole("listitem").first()).toHaveText(line.split("; ")[0]);
  await card.getByRole("button", { name: "[MORE DETAILS]" }).click();
  const details = page.locator("[data-net-worth-event-detail]");
  await expect(details).toBeVisible();
  if (isMobile) {
    await expectSheet(page, details);
  } else {
    // Still inside the chart.
    const area = (await chart.boundingBox())!;
    const box = (await details.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height + 1);
  }
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(details).toHaveCount(0);
});

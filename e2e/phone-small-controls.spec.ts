import { expect, test, type Locator } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Mobile pass (founder, 11-16: "tap targets under 44 px or controls too close together"), the
// rest of the list. On a 375 × 812 phone: /transactions' select, button and checkbox (its label),
// /profile's Correct, the month close's chips and links are 44 px tap targets; and a tap on
// Home's cash-flow strip that misses its small markers opens the nearest one.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function tall(target: Locator, what: string) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  expect(Math.round(box.height), `${what} is a tap target`).toBeGreaterThanOrEqual(44);
}

test("the rest of the phone pass's small controls are 44 px, and the strip answers a near tap", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  await page.setViewportSize({ width: 375, height: 812 });
  userId = await demoPerson(context, page, baseURL);

  await page.goto("/transactions");
  const row = page
    .locator("main form")
    .filter({ has: page.locator("select") })
    .first();
  await tall(row.locator("select").first(), "a category");
  await tall(row.locator("button[type=submit]").first(), "its save");
  await tall(
    row.locator("label", { has: page.locator("input[type=checkbox]") }).first(),
    "a checkbox",
  );

  await page.goto("/profile");
  await tall(page.getByRole("button", { name: "Correct" }).first(), "Correct");

  await page.goto("/home");
  await page.getByRole("link", { name: /Last month's close/ }).click();
  await expect(page).toHaveURL(/\/close\/\d{4}-\d{2}/);
  const chips = page.getByRole("group", { name: "What matters now" }).getByRole("link");
  if (await chips.count()) await tall(chips.first(), "a close chip");
  await tall(page.getByRole("link", { name: "Every saving ›" }), "Every saving");

  // The strip: a tap 20 px off a marker, on the strip, opens that marker's card.
  await page.goto("/home");
  const strip = page.getByRole("group", { name: /^Next 30 days/ });
  await strip.scrollIntoViewIfNeeded();
  const mark = strip.locator("button[id^=cash-event-]").first();
  const m = (await mark.boundingBox())!;
  const s = (await strip.boundingBox())!;
  const below = m.y + m.height / 2 + 20 < s.y + s.height;
  await page.mouse.click(m.x + m.width / 2, m.y + m.height / 2 + (below ? 20 : -20));
  await expect(page.locator("#cash-tip")).toBeVisible();
});

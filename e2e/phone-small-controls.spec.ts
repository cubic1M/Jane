import { expect, test, type Locator } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Mobile pass (founder, 11-16: "tap targets under 44 px or controls too close together"), the
// rest of the list. On a 375 × 812 phone: /transactions' select, button and checkbox (its label),
// /profile's Correct, the month close's chips and links are 44 px tap targets. (Home's month-ahead
// strip, and the near-tap rule for its markers, are gone: founder 11-24.)

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

test("the rest of the phone pass's small controls are 44 px", async ({
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

  await page.goto("/close");
  await expect(page).toHaveURL(/\/close\/\d{4}-\d{2}/);
  const chips = page.getByRole("group", { name: "What matters now" }).getByRole("link");
  if (await chips.count()) await tall(chips.first(), "a close chip");
  await tall(page.getByRole("link", { name: "Every saving ›" }), "Every saving");
});

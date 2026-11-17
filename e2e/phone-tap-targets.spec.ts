import { expect, test, type Locator } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Mobile pass (founder, 11-16: "tap targets under 44 px or controls too close together"). On a
// 375 × 812 phone, the controls the pass found 20 px tall are 44 px tap targets: a report item's
// "Decide later" and "‹ Back to your report", an area page's row of page links, a fold's row,
// and the footer's links.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const TAP = 44;
async function tall(target: Locator, what: string) {
  await expect(target, what).toBeVisible();
  const box = (await target.boundingBox())!;
  expect(Math.round(box.height), `${what} is a tap target`).toBeGreaterThanOrEqual(TAP);
}

test("the small controls the phone pass found are 44 px tap targets", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  await page.setViewportSize({ width: 375, height: 812 });
  userId = await demoPerson(context, page, baseURL);

  // A report item.
  await page.goto("/report");
  const item = page.locator('main a[href^="/report/c"]').first();
  await page.goto((await item.getAttribute("href"))!);
  await tall(page.getByRole("link", { name: "‹ Back to your report" }), "Back to your report");
  await tall(page.getByRole("link", { name: "Decide later" }), "Decide later");

  // An area page's row of page links, and a fold's row.
  await page.goto("/money");
  const row = page.getByRole("navigation", { name: "Spending and bills pages" });
  for (const name of ["Coming up", "Subscriptions", "Transactions"]) {
    await tall(row.getByRole("link", { name, exact: true }), name);
  }
  await page.goto("/loans");
  await tall(page.locator("main summary", { hasText: "All loans and credit pages" }), "a fold");

  // The footer's links, signed out.
  await context.clearCookies();
  await page.goto("/login");
  for (const name of ["Privacy", "Terms", "Security"]) {
    await tall(page.locator("footer").getByRole("link", { name, exact: true }), name);
  }
});

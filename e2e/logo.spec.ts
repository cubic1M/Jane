import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Jane's logos are only logos (founder: "you should not be able to click the top right Jane logo
// and it does anything. It should just be the logo, and no interaction"): the ">Jane" in the top
// bar and the "J_" over the chat are no link or button, take no focus, and a click changes
// nothing. The tabs and labelled buttons do the moving.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("Jane's logos are plain marks: no link, no button, a click does nothing", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/insurance");
  if (isMobile) await page.getByRole("button", { name: /^Chat with Jane/ }).click();
  const logos = page.locator("[data-jane-logo]");
  await expect(logos.first()).toBeVisible({ timeout: 60_000 });
  expect(await logos.count()).toBeGreaterThanOrEqual(2);
  for (const logo of await logos.all()) {
    expect(
      await logo.evaluate((el) => ({
        inControl: !!el.closest("a, button, [role=link], [role=button]"),
        focusable: el.tabIndex >= 0,
        cursor: getComputedStyle(el).cursor,
      })),
    ).toEqual({ inControl: false, focusable: false, cursor: "default" });
  }
  // Clicking the top bar's ">Jane" stays on this page.
  await page.locator("#app-top-bar [data-jane-logo]").click({ force: true });
  await page.waitForTimeout(500);
  await expect(page).toHaveURL("/insurance");
  // Home is a tab.
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Home/ }),
  ).toHaveCount(1);
});

import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debug 3 (11-17, re-walking #1977 on a phone): right after an upload, "Go to Home" (792 px down
// /import on a phone) sometimes opened Home 792 px down, so the upload notice now at the top of the
// page was off screen: 3 of 6 taps, one of them with Home's answer held 2 s (a slow phone). Home
// opened from the upload starts at the top, every time, and so does Home after linking a bank.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

// Where the page stands from the moment Home has drawn (no skeleton) until well after: always the top.
async function staysAtTop(page: Page) {
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator("[data-home-loading]")).toHaveCount(0, { timeout: 30_000 });
  const seen: number[] = [];
  for (let i = 0; i < 15; i++) {
    seen.push(await page.evaluate(() => Math.round(scrollY)));
    await pause(100);
  }
  expect(seen, "Home's scroll position, every 100 ms for 1.5 s").toEqual(seen.map(() => 0));
}

test("Home opened from an upload starts at the top, on time and on a slow phone", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  await page.setViewportSize({ width: 375, height: 812 });
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);

  const arrivals = [
    { file: "e2e/fixtures/messy/checking.csv", slowMs: 0 },
    { file: "e2e/fixtures/messy/card-aug-oct.csv", slowMs: 2000 },
  ];
  for (const { file, slowMs } of arrivals) {
    await page.goto("/import");
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
    await expect(page.locator("[data-import-saved]")).toBeVisible({ timeout: 60_000 });
    // The notice has its answer, so the next page keeps its room (#1977).
    await expect(page.locator("[data-import-chip]")).toBeVisible({ timeout: 30_000 });
    const home = page.getByRole("link", { name: "Go to Home" });
    await home.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => scrollY), "the link is down the page").toBeGreaterThan(0);
    if (slowMs)
      await page.route(/\/home(\?|$)/, async (route) => {
        await pause(slowMs);
        await route.continue();
      });
    await home.click();
    await staysAtTop(page);
    const chip = (await page.locator("[data-import-chip]").boundingBox())!;
    expect(chip.y, "the upload notice is on the first screen").toBeGreaterThanOrEqual(0);
    await page.unrouteAll();
  }
});

test("Home after linking a bank starts at the top", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  await page.setViewportSize({ width: 375, height: 812 });
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);

  await page.goto("/connect");
  const link = page.getByRole("button", { name: "Link a demo bank" });
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await staysAtTop(page);
});

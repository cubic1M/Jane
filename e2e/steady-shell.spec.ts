import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Reviewer polish: nothing jumps in the first minutes. A page that's loading already has the top
// bar (so it doesn't draw full width and then shift under it and beside the docked chat), a tap
// on a tab never makes the bar blink away, and a reload paints Jane's cards above the chat at
// once instead of pushing the chat down.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the top bar holds still while pages load", async ({ context, page, baseURL, isMobile }) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await waitForImport(page, { open: "/report" });

  // A reload paints the cards the tab last showed above the docked chat at once, before (and
  // here without) the dock's own fetch, so the chat isn't pushed down when they arrive.
  if (!isMobile) {
    const card = page.locator("[data-card-dock] [data-card-state='showing']");
    // Jane's cards are posted once the chat has opened: a later load shows them.
    await expect(async () => {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });
    // The dock's own fetch held back well past when the card must show.
    await page.route("**/api/chat/cards", async (route) => {
      await new Promise((done) => setTimeout(done, 8_000));
      await route.continue().catch(() => {});
    });
    await page.reload();
    await expect(card).toBeVisible({ timeout: 5_000 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }

  // A tap on a tab: the bar is there in every frame until the next page is. On a page of its
  // own: one that has intercepted requests makes Next load the next page in full.
  const tab = await context.newPage();
  await tab.goto("/home");
  // The tabs are in the page's own boundary, which hydrates after the root's "taps ready": a tap
  // before that follows the plain link, a full load (still a working tab, just not the test).
  await tab.waitForLoadState("load");
  await expect(tab.locator("[data-giant-tree]")).toBeVisible();
  await tab.waitForTimeout(1_000);
  await tab.evaluate(() => {
    const w = window as unknown as { barGone: boolean };
    w.barGone = false;
    new MutationObserver(() => {
      if (!document.getElementById("app-top-bar")) w.barGone = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await tab
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Spending & bills", exact: true })
    .click();
  await expect(tab).toHaveURL(/\/money/);
  await expect(tab.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await tab.evaluate(() => (window as unknown as { barGone: boolean }).barGone)).toBe(false);
});

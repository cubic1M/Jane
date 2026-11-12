import { expect, test, type Page } from "@playwright/test";
import {
  E2E_DATABASE_URL,
  addFreelancer,
  deleteUser,
  setCheckingBalance,
  signedInUser,
} from "./db";

// Pages come back from the browser's memory (src/lib/page-cache.ts), so a correction on the tax
// calculation has to reach a Spending & bills that was kept: coming back by a link, or by Back, shows Safe to
// spend as it is now. Prefetching and the memory only run on a production build.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.skip(process.env.E2E_PROD !== "1", "the page memory only runs on a production build");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const SETTLED = "main [data-loading-bar],[data-header-loading],[data-nav-pending]";

async function settled(page: Page) {
  await page.locator("#app-top-bar").waitFor({ state: "attached", timeout: 60_000 });
  await expect(page.locator(SETTLED)).toHaveCount(0, { timeout: 60_000 });
}

// By the header's link, as a person moves: the router may answer it from memory.
async function tab(page: Page, path: string) {
  const link = page.locator(`#main-nav a[href="${path}"]`);
  await link.scrollIntoViewIfNeeded();
  await link.click({ noWaitAfter: true });
  await expect(page).toHaveURL(path);
  await settled(page);
}

// Figures start hidden on every return.
async function safeDollars(page: Page) {
  await page.getByRole("button", { name: /SHOW VALUE.* of safe to spend/i }).click();
  const figure = page.locator('[data-hub-number="safe"]');
  await expect(figure).toHaveText(/\$[\d,]+/);
  return Number((await figure.innerText()).replace(/[^0-9.]/g, ""));
}

// The tree's item, by clicks, so the page stays in this tab's memory.
async function openCalculation(page: Page) {
  const tree = page.getByRole("tree", { name: "Taxes" });
  await tree
    .locator('[role="treeitem"][aria-level="2"]')
    .filter({ hasText: "This year's numbers" })
    .first()
    .click();
  await tree
    .locator('[role="treeitem"][aria-level="3"]')
    .filter({ hasText: "Tax not yet paid" })
    .first()
    .click();
  return page.locator("#set-aside");
}

test("a correction reaches a Spending & bills kept in memory, and so does its undo", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "moves by the header's links");
  const user = await signedInUser("user");
  userId = user.userId;
  await addFreelancer(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/money");
  await settled(page);
  const first = await safeDollars(page);
  expect(first).toBeGreaterThan(0);

  // The money moves on the server and nothing tells the browser: the page is coming from its memory.
  await setCheckingBalance(user.userId, 6_000_100);
  await tab(page, "/taxes");
  await tab(page, "/money");
  expect(await safeDollars(page)).toBe(first);

  // A payment pointed out: $1,000 less held back, on top of the $1 above.
  await tab(page, "/taxes");
  let section = await openCalculation(page);
  await section.getByText("Point something out").click();
  await section.getByLabel("What should Jane know?").selectOption("paid_federal");
  await section.getByLabel("Amount").fill("1000");
  await section.getByRole("button", { name: "Work it out again" }).click();
  await expect(section).toContainText("A tax payment, $1,000.00");

  await tab(page, "/money");
  const corrected = await safeDollars(page);
  expect(Math.abs(corrected - (first + 1001))).toBeLessThanOrEqual(1);

  // Back to the calculation, and Back to Spending & bills: neither shows the old number.
  await tab(page, "/taxes");
  await page.goBack();
  await expect(page).toHaveURL(/\/money(\?|$)/);
  await settled(page);
  expect(await safeDollars(page)).toBe(corrected);

  // The undo reaches it too.
  await tab(page, "/taxes");
  section = await openCalculation(page);
  await section.getByRole("button", { name: /Undo\s*:\s*A tax payment/ }).click();
  await expect(section).not.toContainText("A tax payment, $1,000.00");
  await tab(page, "/money");
  expect(Math.abs((await safeDollars(page)) - (first + 1))).toBeLessThanOrEqual(1);
});

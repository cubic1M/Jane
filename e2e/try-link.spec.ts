import { devices, expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, readyTrialPeople } from "./db";

// The one-tap demo link (src/app/try/route.ts): opening /try, with no sign-up, lands on the
// report of the visitor's own sample person: what Jane found, how sure it is of each, and the
// checkup, labelled as sample data. On a desktop and on a 375px phone. Needs the scratch
// database (see e2e/db.ts).
test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL");
test.setTimeout(240_000);

// Each visit its own address: the link is limited per IP, and local runs have none.
const freshIp = () =>
  `10.77.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;

async function openTry(page: Page) {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": freshIp() });
  const opened = Date.now();
  const response = await page.goto("/try");
  // The /try answer itself: a ready person ("ready") or one made there and then ("new").
  const how = await response?.request().redirectedFrom()?.response();
  return { opened, how: (await how?.headerValue("x-try")) ?? null };
}

async function seesFindings(page: Page, timeout: number) {
  await expect(page).toHaveURL(/\/report$/);
  // Labelled as sample data.
  await expect(page.getByRole("note").filter({ hasText: "sample person" })).toContainText(
    "fake data",
  );
  await expect(page.getByRole("heading", { level: 1, name: /^We found / })).toBeVisible({
    timeout,
  });
  const top = page.getByRole("list", { name: "What matters now" }).getByRole("listitem");
  await expect(top.first()).toBeVisible();
  // Every finding says how sure Jane is.
  const shown = await top.count();
  expect(shown).toBeGreaterThan(0);
  await expect(top.locator("[data-finding-confidence]")).toHaveCount(shown);
  await expect(top.first().locator("[data-finding-confidence]")).toHaveText(/^\d{1,3}% sure, /);
  // And the checkup: every check Jane ran.
  await expect(page.getByText(/\d+ of \d+ checks passed/)).toBeVisible();
}

async function noSidewaysScroll(page: Page) {
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(wide).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 375, height: 812 });
});

test("opening /try shows a sample person's findings, with no sign-up", async ({ page }) => {
  const { opened } = await openTry(page);
  // Whether a person was ready or not (a fresh database has none yet), the findings come.
  await seesFindings(page, 120_000);
  console.log(`try link, first open: findings after ${Date.now() - opened}ms`);
  await noSidewaysScroll(page);

  // Opening it again is the same person, not a new one.
  const again = await openTry(page);
  expect(again.how).toBeNull();
  await expect(page).toHaveURL(/\/report$/);
});

// What makes the link fast: a person already scanned is handed out, so the report has its
// findings on its first draw (about 1 to 4 seconds on a production build: try-link.md in the
// shared notes). Only logged here: other specs' scans share this server, so a clock bound flakes.
test("with a person ready, /try hands them out and the report has the findings at once", async ({
  browser,
  isMobile,
}) => {
  const freshPage = async () => {
    const context = await browser.newContext(
      isMobile ? { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } : {},
    );
    return context.newPage();
  };
  // The first visit (or the one before) tops the pool up after its response.
  if ((await readyTrialPeople()) === 0) await openTry(await freshPage());
  // Another test may take the last ready person at the same moment: then a fresh browser waits
  // for the next one.
  let page = await freshPage();
  let opened = 0;
  for (let attempt = 1; ; attempt++) {
    await expect.poll(readyTrialPeople, { timeout: 180_000, intervals: [2000] }).toBeGreaterThan(0);
    const tried = await openTry(page);
    opened = tried.opened;
    if (tried.how === "ready") break;
    expect(attempt, "a ready person was handed out").toBeLessThan(3);
    page = await freshPage();
  }
  // Never the "still reading" report: the findings are there on its first draw.
  await expect(page.locator("[data-report-scanning]")).toHaveCount(0);
  await seesFindings(page, 15_000);
  console.log(`try link, person ready: findings after ${Date.now() - opened}ms`);
  await noSidewaysScroll(page);
});

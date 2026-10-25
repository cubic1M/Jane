import { expect, test } from "@playwright/test";

test("landing page shows the promise and leads to sign-up", async ({ page }) => {
  const landingViewed = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/events") &&
      res.request().postData()?.includes("landing_viewed") === true,
  );

  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "See how much money you're losing" }),
  ).toBeVisible();
  for (const point of ["Read-only access", "You approve everything", "Delete anytime"]) {
    await expect(page.getByRole("heading", { name: point })).toBeVisible();
  }
  expect((await landingViewed).status()).toBe(204);

  const getStartedClicked = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/events") &&
      res.request().postData()?.includes("get_started_clicked") === true,
  );
  await page.getByRole("link", { name: "Get started" }).click();

  await expect(page).toHaveURL("/signup");
  expect((await getStartedClicked).status()).toBe(204);
});

test("health check responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ ok: true });
});

// The column (founder, 2026-10-25): the founder's weathered column in fine ASCII, fixed beside
// the story, panning from its broken capital at the top of the page to its whole base at the
// bottom.
test("the column pans from capital to base as the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  const column = page.getByTestId("landing-column");
  const art = column.locator("pre");
  await expect(art).not.toBeEmpty();
  // Several screens tall.
  await expect
    .poll(async () => Number(await column.getAttribute("data-height")))
    .toBeGreaterThan(860 * 2);
  const top = (await art.boundingBox())!.y;
  await page.evaluate(() =>
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
  );
  // At the bottom of the page the base is in view: the drawing has slid up by its extra height.
  await expect.poll(async () => (await art.boundingBox())!.y).toBeLessThan(top - 100);
  const box = (await art.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(860 + 2);
  // The panel itself stays put on screen.
  expect(Math.abs((await column.boundingBox())!.y)).toBeLessThan(2);
  // The headline face, and the white page.
  const heading = page.getByRole("heading", { level: 1, name: "See how much money you're losing" });
  expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /Agraham.*Playfair Display/,
  );
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    "rgb(255, 255, 255)",
  );

  // A phone: behind the words, nothing wider than the screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(column).toBeAttached();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("without JavaScript the page still tells the story", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Money leaks quietly" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Put your money back together" })).toBeAttached();
  await context.close();
});

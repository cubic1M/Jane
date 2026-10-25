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

// The pillar (founder, 2026-10-25): an ASCII Roman column, still on screen while the story scrolls,
// broken at the top of the page and fully repaired at the bottom.
test("the pillar stays put and is rebuilt as the page scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  const pillar = page.getByTestId("landing-pillar");
  const art = pillar.locator("pre");
  await expect(art).toBeVisible();
  await expect(pillar).toHaveAttribute("data-stage", "1");
  const top = await art.textContent();
  const where = (await pillar.boundingBox())!;

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(pillar).toHaveAttribute("data-stage", "8");
  expect(await art.textContent()).not.toBe(top);
  // Still in the same place on screen: it doesn't scroll with the words.
  const after = (await pillar.boundingBox())!;
  expect(Math.abs(after.y - where.y)).toBeLessThan(2);
  // The headline face, and the white page.
  const heading = page.getByRole("heading", { level: 1, name: "See how much money you're losing" });
  expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /Agraham.*Playfair Display/,
  );
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    "rgb(255, 255, 255)",
  );

  // Back up: broken again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(pillar).toHaveAttribute("data-stage", "1");

  // A phone: behind the words, nothing wider than the screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(art).toBeAttached();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("without JavaScript the page shows the broken pillar and the story", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("landing-pillar").locator("pre")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: "Money leaks quietly" })).toBeAttached();
  await context.close();
});

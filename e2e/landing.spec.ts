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

// The hero (founder, 2026-10-24): the biggest words in the display serif, the picture as ASCII
// diamonds beside them on a wide screen and under them on a phone, and the same dotted diamonds
// across the whole page.
test("the hero shows the ASCII diamond art beside the headline, as a canvas or its poster", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1, name: "See how much money you're losing" });
  const art = page.getByTestId("landing-art");
  await expect(art).toBeVisible();
  // Drawn on the canvas once the script runs; the poster until then.
  await expect(art).toHaveAttribute("data-rendered", "canvas", { timeout: 15_000 });
  const size = await art.locator("canvas").evaluate((c: HTMLCanvasElement) => [c.width, c.height]);
  expect(size[0]).toBeGreaterThan(0);
  expect(size[1]).toBeGreaterThan(0);
  const [h, a] = [await heading.boundingBox(), await art.boundingBox()];
  expect(a!.x).toBeGreaterThan(h!.x + h!.width - 1);
  // The display face for the headline, the page's dotted diamonds behind everything.
  expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /Aguero Serif.*Fraunces/,
  );
  await expect(page.getByTestId("diamond-background")).toHaveCSS("background-image", /url\(/);

  // A phone: the art under the words, nothing wider than the screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(async () => (await art.boundingBox())!.y)
    .toBeGreaterThan((await heading.boundingBox())!.y + 10);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  expect((await art.boundingBox())!.width).toBeLessThanOrEqual(375);
});

test("without JavaScript the hero shows the pre-rendered poster", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
  const art = page.getByTestId("landing-art");
  await expect(art).toHaveAttribute("data-rendered", "poster");
  const poster = art.locator("img");
  await expect(poster).toBeVisible();
  expect(
    await poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
  ).toBeGreaterThan(0);
  await context.close();
});

import { expect, test, type Page } from "@playwright/test";
import { PILLAR_FRAMES } from "../src/content/pillar-frames";

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
  // The first of the two ways in (the story's start and its end).
  await page.getByRole("link", { name: "Get started" }).first().click();

  await expect(page).toHaveURL("/signup");
  expect((await getStartedClicked).status()).toBe(204);
});

test("health check responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ ok: true });
});

// The landing page's story (founder, 2026-10-25): an ASCII Roman column that never moves on the
// screen, broken at the top of the page and rebuilt as it scrolls, whole at the bottom beside
// "Try it with sample data".

const scrollTo = (page: Page, share: number) =>
  page.evaluate(
    (s) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * s),
    share,
  );

// Where the pillar is on the screen.
const place = (page: Page) =>
  page.getByTestId("pillar").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y) };
  });

const trimmed = (art: string) =>
  art
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trimEnd();

for (const size of [
  { width: 1280, height: 860 },
  { width: 375, height: 812 },
]) {
  test(`at ${size.width}px the pillar is broken at the top, whole at the bottom, and never moves`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    const pillar = page.getByTestId("pillar");
    await expect(pillar).toHaveAttribute("data-frame", "1");
    expect(trimmed((await pillar.textContent()) ?? "")).toBe(trimmed(PILLAR_FRAMES[0]));
    const top = await place(page);

    await scrollTo(page, 0.5);
    await expect(pillar).not.toHaveAttribute("data-frame", "1");
    await expect(pillar).not.toHaveAttribute("data-frame", "8");

    await scrollTo(page, 1);
    await expect(pillar).toHaveAttribute("data-frame", "8");
    expect(trimmed((await pillar.textContent()) ?? "")).toBe(trimmed(PILLAR_FRAMES[7]));
    expect(await place(page)).toEqual(top);
    // Beside it, the way in.
    await expect(page.getByRole("button", { name: "Try it with sample data" })).toBeInViewport();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCSS(
      "font-family",
      /Agraham.*Playfair Display/,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);

    // Back up: broken again.
    await scrollTo(page, 0);
    await expect(pillar).toHaveAttribute("data-frame", "1");
  });
}

test("under reduced motion the pillar steps whole frames", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const pillar = page.getByTestId("pillar");
  for (const share of [0.3, 0.6]) {
    await scrollTo(page, share);
    await page.waitForTimeout(200);
    const frame = Number(await pillar.getAttribute("data-frame"));
    expect(trimmed((await pillar.textContent()) ?? "")).toBe(trimmed(PILLAR_FRAMES[frame - 1]));
  }
});

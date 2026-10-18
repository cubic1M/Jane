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

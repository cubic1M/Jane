import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// The monthly check-in is part of the month's one report (docs/feature-audit.md, cluster 2):
// an old check-in link lands on the same month's report, which has the check-in's figures.
test("an old check-in link opens the month's report", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/check-in?m=2026-08");
  await expect(page).toHaveURL(/\/monthly\?m=2026-08$/);
  await expect(page.getByRole("heading", { name: "August 2026 money report" })).toBeVisible();
  await expect(page.getByText("In August you spent")).toBeVisible();
  await expect(page.getByText("Came in", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "‹ July 2026" }).click();
  await expect(page).toHaveURL(/\/monthly\?m=2026-07$/);
  await expect(page.getByRole("link", { name: "August 2026 ›" })).toBeVisible();
});

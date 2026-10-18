import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a person fixes a category for a merchant", async ({ context, page, baseURL }) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page).toHaveURL("/report", { timeout: 30_000 });

  await page.goto("/transactions?q=netflix");
  await page.locator("summary").first().click();
  await page.getByLabel("Category").first().selectOption({ label: "Other entertainment" });
  await page.getByLabel("Always use this for this merchant").first().check();
  await page.getByRole("button", { name: "Save category" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved for this merchant" }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByText("(yours)").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your merchant rules" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

import { expect, test } from "@playwright/test";

// Spec step 138: a visitor tries Jane with sample data, without signing up, and lands in
// Jane's chat as their own sample person. Needs the scratch database (see e2e/db.ts).
test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");

test("'Try it with sample data' opens Jane's chat with a sample person", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: "Try it with sample data" });
  await expect(button).toBeVisible();
  await page.getByRole("checkbox").check();
  await button.click();

  await expect(page).toHaveURL(/\/chat$/, { timeout: 60_000 });
  await expect(page.getByRole("note").filter({ hasText: "sample person" })).toContainText(
    "deleted after a day",
  );
  await expect(page.getByText(/^Good (morning|afternoon|evening)!/).first()).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The founders' beta numbers (/admin/numbers): a 404 for everyone but an admin, and for an
// admin the copy-ready line, every number with its week, and what was left out. Other test
// runs add people to the same database, so it checks the shape, not the counts.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

test("signed-out visitors get a 404", async ({ page }) => {
  const response = await page.goto("/admin/numbers");
  expect(response?.status()).toBe(404);
});

test.describe("signed in", () => {
  let userId: string | undefined;

  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
  });

  test("a non-admin gets a 404", async ({ context, page, baseURL }) => {
    const user = await signedInUser("user");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
    const response = await page.goto("/admin/numbers");
    expect(response?.status()).toBe(404);
  });

  test("an admin sees the numbers, the line to copy and what was left out", async ({
    context,
    page,
    baseURL,
  }) => {
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
    const response = await page.goto("/admin/numbers");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Beta numbers", level: 1 })).toBeVisible();
    await expect(page.locator("[data-copy-line]")).toHaveText(
      /^\d+ beta users? · (\$[\d,]+\/yr found per person · )?\d+ fix(es)? made/,
    );
    for (const name of [
      "Signed up",
      "Uploaded or connected an account",
      "Have at least one finding",
      "Found per person per year (median)",
      "Found per person per year (mean)",
      "Fixes marked done",
      "Verified savings per year",
      "Weekly active people",
      "Sign-up to first finding (median)",
    ]) {
      await expect(page.getByRole("rowheader", { name, exact: true })).toBeVisible();
    }
    await expect(page.locator("[data-excluded]")).toContainText(
      /\d+ trial (person|people) \(sample data\), \d+ team and founder accounts?, \d+ demo-bank-only accounts?\./,
    );
  });
});

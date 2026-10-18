import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The team's queue: non-admins get a 404 everywhere under /admin; an admin can move an
// approved action and the person sees the new status on /actions.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

const ADMIN_PATHS = ["/admin", "/admin/queue", "/admin/metrics", "/admin/actions/anything"];

for (const path of ADMIN_PATHS) {
  test(`signed-out visitors get a 404 at ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
  });
}

test.describe("signed in", () => {
  let userId: string | undefined;

  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
  });

  test("a non-admin gets a 404 on every /admin route", async ({ context, page, baseURL }) => {
    const user = await signedInUser("user");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);

    for (const path of ADMIN_PATHS) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }
  });

  test("an admin moves an action and the person sees it", async ({ context, page, baseURL }) => {
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);

    // Approve a card as this (admin) user, so there's an action in the queue.
    await page.goto("/import");
    await page.getByLabel("Name").fill("Test Card");
    await page.getByLabel("Type").selectOption({ label: "Credit card" });
    await page.getByRole("button", { name: "Add account" }).click();
    await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
    await expect(page).toHaveURL("/report", { timeout: 30_000 });
    await page.getByRole("link", { name: /Netflix went up/ }).click();
    await page.getByRole("button", { name: "Yes, do this for me" }).click();
    await expect(page).toHaveURL("/actions");

    await page.goto("/admin/queue");
    // Other test runs share the queue; pick this user's action.
    await page
      .getByRole("link")
      .filter({ hasText: `${user.userId}@example.test` })
      .click();
    await expect(page.getByRole("heading", { name: "What they approved" })).toBeVisible();
    const form = page.locator("form", { has: page.getByRole("button", { name: "Save" }) });

    // Closing without minutes is blocked.
    await form.getByLabel("Status").selectOption({ label: "Done" });
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("alert")).toContainText("minutes");

    await form.getByLabel("Status").selectOption({ label: "Waiting on you" });
    await form.getByLabel(/What the person needs to do/).fill("Reply to Netflix's email");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("status")).toContainText("Saved");

    await page.goto("/actions");
    const action = page.getByRole("listitem").filter({ hasText: "Netflix went up" });
    await expect(action).toContainText("Waiting on you");
    await expect(action).toContainText("Reply to Netflix's email");
  });
});

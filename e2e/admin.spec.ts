import { expect, test } from "@playwright/test";
import { isHiddenPage, shownHref } from "../src/config/hidden-pages";
import { E2E_DATABASE_URL, deleteUser, signedInUser, treatAsDemoBank } from "./db";
import { openFinding } from "./report-page";

// The team's queue: non-admins get a 404 everywhere under /admin; an admin can move an
// approved action and the person sees the new status on /actions.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

const ADMIN_PATHS = [
  "/admin",
  "/admin/queue",
  "/admin/metrics",
  "/admin/learning",
  "/admin/actions/anything",
];

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

  test("an admin sees the learning loop, kind by kind", async ({ context, page, baseURL }) => {
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
    const response = await page.goto("/admin/learning");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Learning", level: 1 })).toBeVisible();
    await expect(page.getByText(/Trial people never count/)).toBeVisible();
  });

  test("an admin moves an action and the person sees it", async ({ context, page, baseURL }) => {
    // The person's side is /actions, hidden in the read-only beta (src/config/hidden-pages.ts).
    test.skip(isHiddenPage("/actions"), "/actions is hidden in the read-only beta");
    const user = await signedInUser("admin");
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);

    // Approve a card as this (admin) user, so there's an action in the queue. Insurance is
    // the team's, never the agent's, so it stays in the queue however fast the agent is.
    await page.goto("/import");
    await page.getByLabel("Name").fill("Test Card");
    await page.getByLabel("Type").selectOption({ label: "Credit card" });
    await page.getByRole("button", { name: "Add account" }).click();
    await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
    await expect(page).toHaveURL("/report", { timeout: 30_000 });
    // A real account's yes is theirs to do (read-only mode); the queue is the demo bank's.
    await treatAsDemoBank(user.userId);
    await openFinding(page, /Geico insurance/i);
    await page.getByRole("button", { name: "Yes, do this for me" }).click();
    await page.getByRole("link", { name: /^Follow it on / }).click();
    await expect(page).toHaveURL(shownHref("/actions"));

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

    await form.getByLabel("Status").selectOption({ label: "Waiting on the person" });
    await form.getByLabel(/What the person needs to do/).fill("Send us your GEICO policy");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByRole("status")).toContainText("Saved");

    await page.goto("/actions");
    const action = page.getByRole("listitem").filter({ hasText: /Geico insurance/i });
    await expect(action).toContainText("Waiting on you");
    await expect(action).toContainText("Send us your GEICO policy");

    // Finishing the first action starts the membership offer. Without Stripe keys only
    // the free reservation is offered; "Not now" hides it.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "What they approved" })).toBeVisible();
    const done = page.locator("form", { has: page.getByRole("button", { name: "Save" }) });
    await done.getByLabel("Status").selectOption({ label: "Done" });
    await done.getByLabel(/Minutes spent/).fill("12");
    await done.getByRole("button", { name: "Save" }).click();
    // A closed action shows a summary instead of the form.
    await expect(page.getByText("after 12 minutes")).toBeVisible();

    await page.goto("/actions");
    const offer = page.getByRole("region", { name: "Membership" });
    await expect(offer).toContainText("We'll keep doing this for you, ongoing.");
    await expect(offer.getByRole("button", { name: "Reserve my spot (free)" })).toBeVisible();
    await expect(offer.getByRole("button", { name: /founding member/ })).toHaveCount(0);
    await offer.getByRole("button", { name: "Not now" }).click();
    await expect(offer).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", { name: "Membership" })).toHaveCount(0);
  });
});

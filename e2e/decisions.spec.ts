import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Import -> report -> approve a card -> the action is queued on /actions, on a
// 375px-wide screen.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.use({ viewport: { width: 375, height: 812 } });
// The dev server compiles each page on first visit.
test.setTimeout(120_000);

let userId: string | undefined;

test.beforeEach(async ({ context, baseURL }) => {
  const user = await signedInUser();
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
});

test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("import, approve a card and see the action queued", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Test Card").first()).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();

  await expect(page).toHaveURL("/report", { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("We found");
  await expectNoSidewaysScroll(page);

  await page.getByRole("link", { name: /Netflix went up/ }).click();
  await expect(page.getByRole("heading", { name: "What changes if you say yes" })).toBeVisible();
  await expect(
    page.getByRole("article").getByText("Could save about $30.00 a year", { exact: true }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.getByRole("button", { name: "Yes, do this for me" }).click();

  await expect(page).toHaveURL("/actions");
  const action = page.getByRole("listitem").filter({ hasText: "Netflix went up" });
  // The agent starts right away on a card's yes, and the simulated company answers in
  // seconds, so a fast run may already show it working, or even done.
  await expect(action).toContainText(/Queued|In progress|Waiting on you|Done/);
  await expectNoSidewaysScroll(page);
});

test("a no can be undone and puts the card back", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page).toHaveURL("/report", { timeout: 30_000 });

  await page.getByRole("link", { name: /Geico/ }).click();
  await page.getByRole("button", { name: "No thanks" }).click();
  await page.getByRole("button", { name: /Undo/ }).click();

  await expect(page.getByRole("button", { name: "Yes, do this for me" })).toBeVisible();
});

test("do it myself: no action for the team, and marking it done counts it", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page).toHaveURL("/report", { timeout: 30_000 });

  await page.getByRole("link", { name: /Netflix went up/ }).click();
  await page.getByRole("button", { name: /I'll do it myself/ }).click();

  await expect(page.getByRole("heading", { name: "Doing it yourself" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Write the email/ })).toHaveAttribute(
    "href",
    /^mailto:\?subject=/,
  );
  await expectNoSidewaysScroll(page);
  // A click before the page has hydrated can be lost: click until it takes.
  await expect(async () => {
    const didIt = page.getByRole("button", { name: "I did it" });
    if (await didIt.isVisible()) await didIt.click({ timeout: 5_000 });
    await expect(page.getByRole("status").filter({ hasText: "You marked this done" })).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 45_000 });

  await page.goto("/actions");
  await expect(page.getByRole("link", { name: /Netflix went up/ })).toContainText("Done");
  // Nothing went to the team's queue.
  await expect(page.getByText("Queued")).toHaveCount(0);
});

import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { demoPerson } from "./demo-person";
import { openFinding } from "./report-page";

// Read-only mode, on a 375px-wide screen. A real account (a CSV import): import -> report ->
// "Show me how" -> the steps and drafts to do it themselves, Copy and Mark done, and nothing
// queued for anyone. The demo bank keeps the concierge flow: Yes queues the action.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.use({ viewport: { width: 375, height: 812 } });
// The dev server compiles each page on first visit.
test.setTimeout(120_000);

let userId: string | undefined;

test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function importSampleCard(page: Page) {
  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Test Card").first()).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page).toHaveURL("/report", { timeout: 60_000 });
}

test.describe("a real account", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    const user = await signedInUser();
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);
  });

  test("Show me how gives the steps and drafts, and nothing is queued", async ({ page }) => {
    await importSampleCard(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("We found");
    await expectNoSidewaysScroll(page);

    await openFinding(page, /Netflix went up/);
    await expect(
      page.getByRole("article").getByText("Could save about $30.00 a year", { exact: true }),
    ).toBeVisible();
    // Nobody acts for a real account: no "do this for me", no promise of a team.
    await expect(page.getByRole("button", { name: "Yes, do this for me" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /I'll do it myself/ })).toHaveCount(0);
    await expect(page.getByText(/our team/i)).toHaveCount(0);
    await expectNoSidewaysScroll(page);

    // A click before the page has hydrated can be lost: click until it takes.
    await expect(async () => {
      const show = page.getByRole("button", { name: "Show me how", exact: true });
      if (await show.isVisible()) await show.click({ timeout: 5_000 });
      await expect(page.getByRole("heading", { name: "Doing it yourself" })).toBeVisible({
        timeout: 5_000,
      });
    }).toPass({ timeout: 45_000 });
    await expect(page).toHaveURL(/\/report\//);
    await expect(page.getByRole("link", { name: /Write the email/ })).toHaveAttribute(
      "href",
      /^mailto:\?subject=/,
    );
    await expect(page.getByRole("button", { name: "Copy the email" })).toBeVisible();
    await expectNoSidewaysScroll(page);

    await expect(async () => {
      const done = page.getByRole("button", { name: "Mark done" });
      if (await done.isVisible()) await done.click({ timeout: 5_000 });
      await expect(
        page.getByRole("status").filter({ hasText: "You marked this done" }),
      ).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });

    await page.goto("/actions");
    await expect(page.getByRole("link", { name: /Netflix went up/ })).toContainText("Done");
    // Nothing went to the team's queue.
    await expect(page.getByText("Queued")).toHaveCount(0);
  });

  test("the plan shows how, with no Yes to all and no autopilot", async ({ page }) => {
    await importSampleCard(page);
    await page.goto("/plan");
    await expect(page.getByText(/you could do/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "This week, Jane will" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Autopilot settings" })).toHaveCount(0);
    // The plan opens with the three that matter most; the rest are behind "more".
    const more = page.locator("[data-plan-more] summary");
    if (await more.count()) await more.click();
    const item = page.getByRole("listitem").filter({ hasText: /Netflix went up/ });
    await expect(item).toContainText("You ask the company");
    await expect(item).not.toContainText("We contact");
    // Read-only: Show me how, and no Yes or No.
    await expect(item.getByRole("button", { name: /^(Yes|No)/ })).toHaveCount(0);
    await item.getByRole("link", { name: /^Show me how/ }).click();
    await expect(page).toHaveURL(/\/report\//);
    await expect(page.getByRole("button", { name: "Show me how", exact: true })).toBeVisible();
  });

  test("a no can be undone and puts the card back", async ({ page }) => {
    await importSampleCard(page);
    await openFinding(page, /Geico/);
    // No is marked at once, Yes greyed, and Revert puts both back.
    await page.getByRole("button", { name: "No thanks" }).click();
    await expect(page.getByRole("button", { name: /^No thanks.*chosen$/ })).toBeVisible({
      timeout: 150,
    });
    await page.getByRole("button", { name: /^Revert/ }).click();

    await expect(page.getByRole("button", { name: "Show me how", exact: true })).toBeVisible();
  });
});

test.describe("the demo bank", () => {
  test("keeps the concierge flow: Yes queues the action for Jane", async ({
    context,
    page,
    baseURL,
  }) => {
    userId = await demoPerson(context, page, baseURL);
    await page.goto("/report");
    await openFinding(page, /Netflix went up/);
    // The demo's Netflix has Jane's pick to switch to: one yes, and the team or the agent acts.
    await expect(page.getByRole("button", { name: /I'll do it myself/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Show me how/ })).toHaveCount(0);
    // Yes is marked at once, with Revert, and the action is on /actions.
    await page.getByRole("button", { name: /^Yes, switch to / }).click();
    await expect(page.getByRole("button", { name: /^Yes, switch to .*chosen$/ })).toBeVisible({
      timeout: 150,
    });
    await expect(page.getByRole("button", { name: "No thanks" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Revert/ })).toBeVisible();
    await page.getByRole("link", { name: /Follow it on your actions/ }).click();
    await expect(page).toHaveURL("/actions", { timeout: 10_000 });
    const action = page.getByRole("listitem").filter({ hasText: "Netflix went up" });
    // The agent starts right away on a card's yes, and the simulated company answers in
    // seconds, so a fast run may already show it working, or even done.
    await expect(action).toContainText(/Queued|In progress|Waiting on you|Done/);
    await expectNoSidewaysScroll(page);
  });
});

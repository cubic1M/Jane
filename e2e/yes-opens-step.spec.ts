import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Debugger round 208 (11-12): Yes on a suggestion recorded the answer and the dock moved on to
// the next card; the step Jane prepared ("Good. Here's where to do it." with Open it) showed
// nowhere, so find → prefill → yes ended at yes. A Yes now opens that step.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const showingIn = (page: Page) =>
  page.locator("[data-card-dock] article[data-card-state='showing']");

test("Yes on a suggestion opens the step Jane prepared", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(
    isMobile,
    "the dock is the computer's; a phone's chat frame opens it through its bridge",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/report");
  // The dock loads its cards after the page.
  await expect(async () => {
    await page.reload();
    await expect(showingIn(page)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  // A suggestion: how sure Jane is, and a Yes.
  let card = showingIn(page);
  for (let i = 0; i < 15; i += 1) {
    card = showingIn(page);
    if (
      (await card.getByText(/\d+% sure/).count()) > 0 &&
      (await card.getByRole("button", { name: "Yes", exact: true }).count()) > 0
    )
      break;
    await page.locator("[data-dock-header]").getByRole("button", { name: /next/ }).click();
  }
  const answer = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/report",
  );
  await card.getByRole("button", { name: "Yes", exact: true }).click();
  await answer;

  // The step's own page, with the way back to the suggestion it came from.
  await expect(page).toHaveURL((url) => url.searchParams.has("from"), {
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Hotfix (#2305 regression): "Done, next step" in the dock sent no `shown` token, so the server
// refused it and the card vanished as if done, nothing saved. The tap moves the step on and the
// card shows the next step; a refused tap keeps the card and says why.
// Not covered here: the dock's "Raise it" (saving.apply), whose token and refusal are covered by
// src/app/chat/dock-tap.integration.test.ts.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const showingIn = (page: Page) =>
  page.locator("[data-card-dock] article[data-card-state='showing']");

const STEP_ONE = "Student loans, step 1 of 5: See your federal loans.";
const STEP_TWO = "Student loans, step 2 of 5";

test("Done, next step in the dock moves the step on and shows the next one", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is the computer's; the phone's sheet shares its code");
  await page.setViewportSize({ width: 1280, height: 800 });
  userId = await demoPerson(context, page, baseURL);
  await addJaneMessage(userId, {
    kind: "decision",
    body: `${STEP_ONE}\nSign in at studentaid.gov and look at every loan you have.`,
    refs: { studentStep: 0 },
    actions: [
      { id: "student.next", label: "Done, next step", kind: "primary" },
      { id: "snooze", label: "Not now", kind: "secondary" },
    ],
  });

  await page.goto("/home");
  // The dock loads its cards after the page; step to the student card.
  const card = showingIn(page).filter({ hasText: STEP_ONE });
  await expect(async () => {
    await page.reload();
    for (let i = 0; i < 15 && (await card.count()) === 0; i += 1) {
      await page
        .locator("[data-dock-header]")
        .getByRole("button", { name: /next/ })
        .click({ timeout: 2_000 });
    }
    await expect(card).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  await card.getByRole("button", { name: "Done, next step" }).click();
  // The card does not vanish as if done: it shows step 2, and it was saved.
  await expect(showingIn(page).filter({ hasText: STEP_TWO })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-card-unsent]")).toHaveCount(0);
  await page.reload();
  await expect(async () => {
    for (
      let i = 0;
      i < 15 && (await showingIn(page).filter({ hasText: STEP_TWO }).count()) === 0;
      i += 1
    ) {
      await page
        .locator("[data-dock-header]")
        .getByRole("button", { name: /next/ })
        .click({ timeout: 2_000 });
    }
    await expect(showingIn(page).filter({ hasText: STEP_TWO })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
});

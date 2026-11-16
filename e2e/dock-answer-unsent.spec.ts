import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";
import { holds } from "./waits";

// Debug 3 (11-16): a card answered while the network was down left the dock at once and never
// came back, and the answer never reached Jane: the person's Not now (or Yes) was lost, with no
// word. A card whose answer didn't go through comes back, says so, and a second try goes.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const showingIn = (page: Page) =>
  page.locator("[data-card-dock] article[data-card-state='showing']");
const goneInTab = (page: Page) =>
  page.evaluate(() => window.sessionStorage.getItem("jane:dock-gone") ?? "[]");
const answerPost = (url: URL) => url.pathname === "/report";

test("an answer that didn't go through puts its card back, and the next try goes", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is the computer's; the phone's sheet shares its code");
  await page.setViewportSize({ width: 1280, height: 800 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/report");
  await expect(async () => {
    await page.reload();
    await expect(showingIn(page)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  const card = showingIn(page);
  const headline = ((await card.locator("h3").first().textContent()) ?? "").trim();
  expect(headline).not.toBe("");
  const goneBefore = await goneInTab(page);

  // The network drops for the answer.
  await page.route(answerPost, (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await card.getByRole("button", { name: "Not now", exact: true }).click();

  // Back, showing, and saying it didn't go through; not kept as gone in the tab either.
  const back = showingIn(page);
  await expect(back.getByRole("status")).toHaveText("That didn't reach me. Try again.", {
    timeout: 15_000,
  });
  await expect(back.locator("h3").first()).toHaveText(headline);
  expect(await goneInTab(page)).toBe(goneBefore);

  // Back online: the same tap goes, and the card leaves for good.
  await page.unroute(answerPost);
  const answered = page.waitForResponse(
    (r) => r.request().method() === "POST" && answerPost(new URL(r.url())),
  );
  await back.getByRole("button", { name: "Not now", exact: true }).click();
  expect((await answered).ok()).toBe(true);
  await holds(async () => {
    expect(
      await page
        .locator("[data-card-dock] article[data-card-state='showing'] h3")
        .filter({ hasText: headline })
        .count(),
    ).toBe(0);
    expect(await page.locator("[data-card-unsent]").count()).toBe(0);
  }, 2_000);
});

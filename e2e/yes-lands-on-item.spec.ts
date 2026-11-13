import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Debugger 11-12: Yes on "Get your employer's full 401(k) match" pushed
// /investments?focus=ideas:investing:employer_match, but the page came from the browser's memory
// rendered without that ?focus= and wiped it on arrival: the student landed on the top of the
// area, not on the thing they'd said yes to. A Yes lands on its own item.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const AREA_ROOTS = ["/insurance", "/loans", "/taxes", "/investments", "/ahead"];
const showingIn = (page: Page) =>
  page.locator("[data-card-dock] article[data-card-state='showing']");

test("Yes on a suggestion lands on its own item, not the top of the area", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is the computer's");
  await page.setViewportSize({ width: 1280, height: 800 });
  userId = await demoPerson(context, page, baseURL);
  // Home first, so the area page is opened in the browser, as after a real Yes.
  await page.goto("/home");
  await expect(async () => {
    await page.reload();
    await expect(showingIn(page)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  // A suggestion whose Yes goes to an area page (the demo bank's first is mortgage insurance).
  let card = showingIn(page);
  for (let i = 0; i < 15; i += 1) {
    card = showingIn(page);
    if (
      (await card.getByText(/mortgage insurance|401\(k\) match|card charging interest/i).count()) >
        0 &&
      (await card.getByRole("button", { name: "Yes", exact: true }).count()) > 0
    )
      break;
    await page.locator("[data-dock-header]").getByRole("button", { name: /next/ }).click();
  }
  await card.getByRole("button", { name: "Yes", exact: true }).click();

  await expect(page).toHaveURL((url) => AREA_ROOTS.includes(url.pathname), { timeout: 30_000 });
  // The item it was about is the one picked, and the address still says so once it settles.
  await expect(page.locator('[role="treeitem"][aria-selected="true"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL((url) => /:/.test(url.searchParams.get("focus") ?? ""));
});

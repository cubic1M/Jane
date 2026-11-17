import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { signInWith } from "./session";

// Mobile pass (founder, 11-16). On a slow phone, Home's net worth chart was drawn for a wide
// screen until the page woke: 260 px tall and past the card's right edge, filling the first
// screen. Before it knows its width it is now out of sight at its phone height; once awake it
// shows, inside the card. (What the server sends is checked in
// src/components/hub/net-worth-first-paint.test.tsx: a page that never wakes keeps its streamed
// parts in hidden holders, so it can't be shown here.)

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("Home's chart on a phone, once awake, is shown inside its card", async ({
  browser,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  const user = await signedInUser("user");
  userId = user.userId;
  const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };

  // The demo bank, linked with JavaScript on.
  const setup = await browser.newContext(phone);
  await signInWith(setup, user.sessionToken, baseURL);
  const page = await setup.newPage();
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).not.toHaveURL(/\/connect$/, { timeout: 60_000 });
  await waitForFullScan(user.userId);

  // Awake: shown, and inside its card.
  await page.goto("/home");
  const live = page.locator("[data-net-worth-plot]");
  await expect(live).toHaveCSS("visibility", "visible");
  const inside = await live.evaluate((el) => {
    const card = el.closest("section, article, [class*='border']")!.getBoundingClientRect();
    const svg = el.querySelector("svg")!.getBoundingClientRect();
    return svg.right <= card.right + 1 && svg.width <= window.innerWidth;
  });
  expect(inside).toBe(true);
  await setup.close();
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { hydrated } from "./waits";

// A tab tapped while its page is still preloading answers at once (main red 11-13, e2e/tap.spec.ts
// 3 of 3 tries: "link to another page took 339 ms"). A preload marks its page as in memory when
// it starts (src/lib/page-cache.ts), so the bar waited as if the page were already here, while it
// was a second away: nothing on screen until it came. Here the page's preload is held back, so
// the tap always lands while it's on its way in.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

const TAP_MS = 150;

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a tab whose page is still on its way in shows the bar at once", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  // Insurance's page data takes its time, whether preloaded or tapped.
  let preloading!: () => void;
  const started = new Promise<void>((resolve) => (preloading = resolve));
  await page.route(
    (url) => url.pathname === "/insurance" && url.searchParams.has("_rsc"),
    async (route) => {
      preloading();
      await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    },
  );

  await page.goto("/tax-pack");
  await page.locator('html[data-taps="ready"]').waitFor({ state: "attached", timeout: 90_000 });
  const tab = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Insurance" });
  await expect(tab).toBeVisible();
  await hydrated(tab);
  // The main pages preload once the first has settled: Insurance's has started, not landed.
  await started;

  await page.evaluate(() => {
    const w = window as unknown as { tapStart: number; barAfter: number };
    addEventListener("pointerdown", () => (w.tapStart = performance.now()), {
      capture: true,
      once: true,
    });
    new MutationObserver(() => {
      if (w.tapStart && !w.barAfter && document.querySelector("[data-nav-pending]"))
        w.barAfter = performance.now() - w.tapStart;
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  });
  await tab.click({ noWaitAfter: true });
  await expect(page.locator("[data-nav-pending]")).toBeAttached({ timeout: 2_000 });
  const ms = await page.evaluate(() => (window as unknown as { barAfter: number }).barAfter);
  expect(ms, `the bar took ${Math.round(ms)} ms to show`).toBeLessThanOrEqual(TAP_MS);
  await expect(page).toHaveURL("/insurance", { timeout: 30_000 });
});

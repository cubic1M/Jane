import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Reviewer polish: nothing jumps in the first minutes. A page that's loading already has the top
// bar (so it doesn't draw full width and then shift under it and beside the docked chat), a tap
// on a tab never makes the bar blink away, and a reload paints Jane's cards above the chat at
// once instead of pushing the chat down.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// How far the page moved by itself (layout shift, without the person's input) since it loaded.
const shifted = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[])
            if (!e.hadRecentInput) total += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 300);
      }),
  );

test("the top bar holds still while pages load", async ({ context, page, baseURL }) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await waitForImport(page, { open: "/home" });
  // The dock has loaded its cards once (the docked chat keeps polling, so no network idle).
  await page.waitForTimeout(2_000);

  // A reload: the cards the tab last showed are painted with the chat, so nothing moves.
  // The import chip (still saying "Done") arrives after the page on a reload too: on a phone it
  // sits beside the Jane button rather than pushing the page down.
  await page.reload();
  await expect(page.locator("[data-import-chip]")).toBeVisible();
  await page.waitForTimeout(1_500);
  expect(await shifted(page)).toBeLessThan(0.05);

  // A tap on a tab: the bar is there in every frame until the next page is.
  await page.evaluate(() => {
    const w = window as unknown as { barGone: boolean };
    w.barGone = false;
    new MutationObserver(() => {
      if (!document.getElementById("app-top-bar")) w.barGone = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Spending & bills", exact: true })
    .click();
  await expect(page).toHaveURL(/\/money/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { barGone: boolean }).barGone)).toBe(
    false,
  );
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { datedToToday } from "./fixture-dates";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";
import { hydrated } from "./waits";

// Mobile pass (manager, 11-16): right after an upload, the first thing a new student sees on Home,
// "Done: 56 transactions read · See findings ✕", floated over the page at the bottom of the screen
// (over "Your plan: 4 things ›" on main, over the chart's 1W / 1M / 3M row with #1974). On a phone
// it now takes its own room at the top of the page and covers nothing, and the next page keeps that
// room from the start, so nothing moves when it comes back. And on a finding's own page
// the do-it-yourself link out ("Open Spotify's account page ↗", debug 3: 24 px) is a 44 px tap.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("after an upload the notice covers nothing on a phone, and a finding's link out is a tap", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's layout");
  await page.setViewportSize({ width: 375, height: 812 });
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  // Dated to today, so what Jane finds in them doesn't change as the calendar moves on.
  const statements = datedToToday([
    "e2e/fixtures/messy/checking.csv",
    "e2e/fixtures/messy/card-aug-oct.csv",
  ]);
  for (const file of statements) {
    await page.goto("/import");
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
    await waitForImport(page, { open: "/home" });
  }

  await page.goto("/home");
  const chip = page.locator('[data-import-chip="done"]');
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveCSS("position", "fixed");
  // In its own room: above the page's header, and on top of nothing.
  const c = (await chip.boundingBox())!;
  const top = (await page.locator("[data-app-top-bar]").first().boundingBox())!;
  expect(c.y + c.height).toBeLessThanOrEqual(top.y + 1);
  const under = await page.evaluate(() => {
    const chipEl = document.querySelector("[data-import-chip]")!;
    const r = chipEl.getBoundingClientRect();
    return [...document.querySelectorAll("a[href], button, [role=button], input, select")]
      .filter((el) => !chipEl.contains(el))
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .filter((b) => b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top)
      .length;
  });
  expect(under).toBe(0);

  // The next page keeps its room from the start: its HTML has the room, and the notice, when it
  // comes, fills exactly that room, so nothing moves.
  await page.goto("/home", { waitUntil: "commit" });
  const room = page.locator("[data-import-chip-room]");
  await room.waitFor({ state: "attached" });
  const r = (await room.boundingBox())!;
  await expect(chip).toBeVisible();
  const n = (await chip.boundingBox())!;
  expect(Math.round(n.y)).toBe(Math.round(r.y));
  expect(Math.round(n.height)).toBe(Math.round(r.height));

  // A finding's own page: its do-it-yourself link out is a tap target (once the scan has run).
  await waitForFullScan(user.userId);
  await page.goto("/report");
  // The report's findings stream in after the page (main 11-17: read at once, there were none).
  const links = page.locator('main a[href^="/report/c"]');
  await expect(links.first()).toBeAttached({ timeout: 30_000 });
  const items = await links.evaluateAll((as) => [
    ...new Set(as.map((a) => a.getAttribute("href")!)),
  ]);
  let checked = false;
  for (const href of items.slice(0, 20)) {
    await page.goto(href);
    // The steps show once the person says they'll do it themselves (a real account's Yes).
    // The buttons come a moment after the page, and a tap before they've hydrated does nothing
    // (main 11-18: read at once, no button; or four taps and no decision sent).
    const how = page.getByRole("button", { name: /show me how/i }).first();
    await how.waitFor({ timeout: 15_000 }).catch(() => {});
    if (await how.count()) {
      await hydrated(how);
      await how.click();
    }
    const out = page.locator("#diy a[target=_blank]").first();
    await out.waitFor({ timeout: 10_000 }).catch(() => {});
    if (!(await out.count())) continue;
    const box = (await out.boundingBox())!;
    expect(
      Math.round(box.height),
      `${await out.textContent()} is a tap target`,
    ).toBeGreaterThanOrEqual(44);
    checked = true;
    break;
  }
  expect(checked, "a finding with a do-it-yourself link out").toBe(true);
});

import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Every tap answers at once (the founder's "every button is an instant response"; the audit is
// tap-audit.md in the side-session notes). One control of each kind the audit found: a link to
// another page, a link to the same page with other search params, a menu, a tree branch and a
// form's submit button. Each must show its change within TAP_MS of the press, timed in the page
// itself from the pointer going down to the change it should make.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

const TAP_MS = 150;

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// The page has hydrated and answers taps (src/components/nav-pending.tsx marks it).
async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.locator('html[data-taps="ready"]').waitFor({ state: "attached", timeout: 90_000 });
}

// Milliseconds from pressing `target` until `changed` (a CSS selector) matches something. The
// page reports it through a binding, so a tap that then leaves the page (Sign out) still counts.
let reported: ((ms: number) => void) | null = null;
async function tapTime(page: Page, target: Locator, changed: string): Promise<number> {
  // On screen and settled: a page still hydrating can swap the node out from under a scroll.
  await expect(async () => {
    await target.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const result = new Promise<number>((resolve, reject) => {
    reported = resolve;
    setTimeout(() => reject(new Error(`no change to ${changed} within 10 s`)), 10_000);
  });
  await page.evaluate((selector) => {
    const w = window as unknown as { reportTap: (ms: number) => void };
    const from = location.pathname + location.search;
    let t0 = 0;
    let done = false;
    // A link counts as answered once its bar shows, or once the next page is already here.
    const leaving = selector === "[data-nav-pending]";
    const check = () => {
      const left = leaving && location.pathname + location.search !== from;
      if (t0 && !done && (left || document.querySelector(selector))) {
        done = true;
        w.reportTap(performance.now() - t0);
      }
    };
    new MutationObserver(check).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    addEventListener(
      "pointerdown",
      () => {
        t0 = performance.now();
      },
      { capture: true, once: true },
    );
  }, changed);
  await target.click({ noWaitAfter: true });
  return result;
}

test("every kind of tap shows its change within 150 ms", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.exposeFunction("reportTap", (ms: number) => reported?.(ms));
  const times: Record<string, number> = {};

  // A link to another page: the bar shows before the page arrives.
  await ready(page, "/tax-pack");
  const tabs = page.getByRole("navigation", { name: "Main" });
  times["link to another page"] = await tapTime(
    page,
    tabs.getByRole("link", { name: "Insurance" }),
    "[data-nav-pending]",
  );
  await expect(page).toHaveURL("/insurance");

  // A link to the same page with other search params (the audit's slowest links): another
  // year of the tax-time pack.
  await ready(page, "/tax-pack");
  times["link to the same page"] = await tapTime(
    page,
    page.locator('main a[href^="/tax-pack?year="]:not([aria-current])').first(),
    "[data-nav-pending]",
  );
  await expect(page).toHaveURL(/\/tax-pack\?year=/);

  // A tree branch (Settings' tree; every area page uses the same one).
  await ready(page, "/settings");
  // A closed branch (an area page's branches sit under its root).
  const branch = page.locator('[role="treeitem"][aria-expanded="false"]').first();
  const id = await branch.getAttribute("data-node");
  times["tree branch"] = await tapTime(
    page,
    branch,
    `[role="treeitem"][data-node="${id}"][aria-expanded="true"]`,
  );

  // A menu, then a form's submit button in it: Sign out answers before the server does.
  const menu = page.getByRole("button", { name: "Your account and settings" });
  times["menu"] = await tapTime(
    page,
    menu,
    'button[aria-label="Your account and settings"][aria-expanded="true"]',
  );
  times["submit button"] = await tapTime(
    page,
    page.getByRole("button", { name: "Sign out" }),
    'button[aria-busy="true"]',
  );

  for (const [kind, ms] of Object.entries(times)) {
    expect(ms, `${kind} took ${Math.round(ms)} ms to show a change`).toBeLessThanOrEqual(TAP_MS);
  }
});

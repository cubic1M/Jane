import { expect, type Frame, type Locator, type Page } from "@playwright/test";

// What to use instead of a fixed sleep (eslint refuses page.waitForTimeout in e2e/). A sleep passes
// on a fast runner and fails on a slow one, and it checks nothing while it waits.

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// For "it never comes back" or "nothing moves", where there's no event to wait for: keeps checking
// for `ms` and fails the moment it isn't so. Use checks that don't retry (count(), not
// toHaveCount), or a violation would wait out its own timeout and might pass.
export async function holds(check: () => Promise<unknown> | unknown, ms = 1_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await check();
    await pause(100);
  }
  await check();
}

// Its box stopped moving: an opening animation or a layout shift is over.
export async function settled(locator: Locator) {
  let last = "";
  await expect
    .poll(
      async () => {
        const box = JSON.stringify(await locator.boundingBox());
        const same = box === last && box !== "null";
        last = box;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
}

// React has attached to this element, so a tap on it is handled and doesn't fall through to the
// browser.
export async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))))
    .toBe(true);
}

// Two frames have been drawn, so scroll and resize events from before this have been delivered.
export async function framesDrawn(target: Page | Frame) {
  await target.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(0))),
      ),
  );
}

// The server has answered what the page saves next (a server action or a chat route). Call this
// before the tap, then await it. Page-activity beacons don't count.
export function nextSave(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && r.ok() && !r.url().includes("/api/activity"),
  );
}

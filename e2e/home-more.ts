import type { Page } from "@playwright/test";

// Home keeps the six areas' tree ("What Jane does") folded under "Everything Jane watches" since
// the home redesign (11-12). Opens it, if it isn't open already.
export async function openHomeMore(page: Page, timeout = 60_000) {
  const more = page.locator("[data-home-more]");
  await more.waitFor({ timeout });
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
}

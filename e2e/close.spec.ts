import { expect, test } from "@playwright/test";

// The monthly close (/close/[month]): a sample person (Try Jane) opens it from Home, sees one
// line of figures, at most three chips, the five parts with each line's detail behind a click,
// and can step back a month. Last month's close for a sample person has Jane's verified wins.
test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");
test.setTimeout(240_000);

const PARTS = ["Found", "You did", "Verified", "Changed", "Open for next month"];

test("a sample person's monthly close, from Home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await expect(page.locator("[data-scan-bar]")).toHaveCount(0, { timeout: 150_000 });

  await page.locator("[data-home-close]").click();
  await expect(page).toHaveURL(/\/close\/\d{4}-\d{2}$/);
  const month = page.url().slice(-7);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ close$/);
  await expect(page.locator("[data-close-figures]")).toHaveText(
    /^Verified \$[\d,.]+ · Found \d+ · Open \d+$/,
  );
  const chips = page.getByRole("group", { name: "What matters now" }).getByRole("link");
  expect(await chips.count()).toBeLessThanOrEqual(3);
  for (const chip of await chips.all()) await expect(chip).toContainText(/% sure|\+/);
  for (const part of PARTS) {
    await expect(page.getByRole("region", { name: part, exact: true })).toBeVisible();
  }

  // Each open item says how sure Jane is, and opens on its rule.
  const open = page.getByRole("region", { name: "Open for next month" });
  const item = open.locator("[data-ledger-entry]").first();
  if ((await item.count()) > 0) {
    await expect(item.locator("summary")).toContainText(/\d+% sure/);
    await item.locator("summary").click();
    await expect(item).toContainText(/Verified when|Stays an estimate/);
  }

  // Back through the months until one has a verified win, with its lines behind a click.
  // Each step waits for the earlier month's heading: the address changes before its page is in,
  // and counting the old page's empty Verified clicked back past the wins (debugger 11-01: on the
  // 1st, Home opens October, with none, so this loop runs; it reached August and timed out).
  let verified = page.getByRole("region", { name: "Verified", exact: true });
  const heading = page.getByRole("heading", { level: 1 });
  for (let i = 0; i < 6 && (await verified.locator("[data-ledger-entry]").count()) === 0; i += 1) {
    const was = await heading.innerText();
    await page.getByRole("navigation", { name: "Months" }).getByRole("link").first().click();
    await expect(page).not.toHaveURL(new RegExp(`${month}$`));
    await expect(heading).not.toHaveText(was);
    verified = page.getByRole("region", { name: "Verified", exact: true });
  }
  const win = verified.locator("[data-ledger-entry]").first();
  await expect(win).toBeVisible();
  await win.locator("summary").click();
  await expect(win.locator("[data-ledger-line]").first()).toBeVisible();

  // A month that hasn't come yet isn't there.
  await page.goto("/close/2999-01");
  await expect(page.getByText("Page not found")).toBeVisible();
});

import { expect, test } from "@playwright/test";

// The savings ledger on /saved: a sample person (Try Jane) sees the headline count only what
// their transactions show, at most three chips on top, and each saving open on the transaction
// lines that prove it. Jane's past wins for every sample person are Held by now.
test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");
test.setTimeout(240_000);

test("a sample person's ledger: Held wins with their lines, estimates apart", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await expect(page.locator("[data-scan-bar]")).toHaveCount(0, { timeout: 150_000 });

  await page.goto("/saved");
  await expect(page.getByRole("heading", { name: "What Jane saved you" })).toBeVisible();
  const headline = page.locator("[data-ledger-saved]");
  expect(Number(await headline.getAttribute("data-ledger-saved"))).toBeGreaterThan(0);

  const chips = page.getByRole("group", { name: "What matters now" }).getByRole("link");
  expect(await chips.count()).toBeLessThanOrEqual(3);
  await expect(chips.first()).toHaveText(/held/);

  const saved = page.getByRole("region", { name: "Verified" });
  const held = saved.locator('[data-ledger-entry="held"]');
  await expect(held).toHaveCount(2);
  // Detail on click: the proof and the line behind it.
  const first = held.first();
  await expect(first.locator("[data-ledger-line]")).toBeHidden();
  await first.locator("summary").click();
  await expect(first.locator("[data-ledger-line]").first()).toBeVisible();
  await expect(first).toContainText(/Held: Still true on/);

  // Estimates are apart and say so; each one says how sure Jane is.
  const estimates = page.getByRole("region", { name: "Estimates" });
  if ((await estimates.count()) > 0) {
    await expect(estimates).toContainText("Not counted until your transactions show it.");
    await expect(estimates.locator("summary").first()).toContainText(/\d+% sure/);
  }

  await page.getByText("How Jane verifies").click();
  await expect(page.getByText("Saved counts Verified and Held only.")).toBeVisible();
});

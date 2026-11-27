import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// "In spending, note out the recurring payments, which would mean they are subscriptions, so
// it's easy to spot" (founder, 11-26). On the sample person: Netflix on Transactions carries the
// small mark, and the mark opens /subscriptions at that charge.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a subscription in spending is marked and the mark opens its row", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);

  // Money's Spending branch: the merchants you spend the most with, behind "More".
  await page.goto("/money?focus=spending:top");
  await page
    .locator("summary", { hasText: /^More$/ })
    .first()
    .click();
  await expect(page.locator('[data-repeat-mark="bill"]').first()).toHaveText(/Repeats monthly/);

  await page.goto("/transactions?q=netflix");
  const mark = page.locator('[data-repeat-mark="subscription"]').first();
  await expect(mark).toHaveText(/Subscription · monthly/);
  // The mark wraps under the name; nothing pushes the page wider than the phone.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  await mark.click();
  // The first visit to /subscriptions compiles on the dev server.
  await expect(page).toHaveURL(/\/subscriptions#charge-/, { timeout: 90_000 });
  const hash = decodeURIComponent(new URL(page.url()).hash.slice(1));
  await expect(page.locator(`[id="${hash}"]`)).toBeVisible();
  await expect(page.locator(`[id="${hash}"]`)).toContainText("Netflix");
});

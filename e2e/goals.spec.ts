import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a person adds a goal and sees what each month would take", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  // A date a year and a day ahead, so the month count is 12 whatever day the test runs.
  const target = new Date();
  target.setUTCFullYear(target.getUTCFullYear() + 1);
  target.setUTCDate(target.getUTCDate() + 1);

  await page.goto("/goals");
  await expect(page.getByText("This is math, not a recommendation.")).toBeVisible();
  await page.getByLabel("What it's for").fill("Trip to Japan");
  await page.getByLabel("Amount ($)").first().fill("1200");
  await page.getByLabel("By", { exact: true }).fill(target.toISOString().slice(0, 10));
  await page.getByLabel("Saved so far ($), if tracking by hand").first().fill("0");
  await page.getByRole("button", { name: "Add goal" }).click();

  await expect(page.getByRole("heading", { name: "Trip to Japan" })).toBeVisible();
  await expect(page.getByText("$100.00 a month for 12 months would get there.")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

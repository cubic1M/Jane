import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the debt planner shows both orders side by side, without recommending one", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/debt");
  await expect(page.getByText("This is math, not a recommendation.")).toBeVisible();
  // $1,000 at 12% with $100 a month: worked out by hand in src/planning/debt.test.ts.
  await page.getByLabel("Balance ($)").fill("1000");
  await page.getByLabel("Rate (APR %)").fill("12");
  await page.getByLabel("Minimum payment ($)").fill("25");
  await page.getByLabel("Paid toward these debts each month ($)").fill("100");

  for (const name of ["Highest rate first", "Smallest balance first"]) {
    const plan = page.getByRole("region", { name });
    await expect(plan.getByText("$58.98")).toBeVisible();
    await expect(plan.getByText(/\(11 months\)/)).toBeVisible();
  }
  await expect(page.getByText(/recommend(ed)? (the|this)|you should/i)).toHaveCount(0);

  await page.getByLabel("Paid toward these debts each month ($)").fill("10");
  await expect(page.getByRole("alert").filter({ hasText: "less than the minimum" })).toHaveCount(2);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("can I afford this shows a purchase's effect before and after, from the URL", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  // Without a bank, a wrong amount is refused and there's nothing to work out yet.
  await page.goto("/afford?amount=abc");
  // Next's route announcer is also role="alert", so pick ours by its text.
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter an amount, like 250." }),
  ).toBeVisible();
  await expect(page.getByText("This is math, not a recommendation.")).toBeVisible();

  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/report", { timeout: 60_000 });

  // Spec step 79: "Can I afford this?" lives under the Ahead tab now, not in a row of
  // links on Home.
  await page.goto("/afford");
  await page.getByLabel("What it is").selectOption("purchase");
  await page.getByLabel("Amount ($)").fill("250");
  await page.getByRole("button", { name: "Show the math" }).click();
  await expect(page).toHaveURL(/\/afford\?kind=purchase&amount=250/);

  await expect(page.getByText(/^Safe to spend( until [A-Z][a-z]{2} \d+)?: .+ → .+$/)).toBeVisible();
  const months = page.getByRole("region", { name: "Checking at the end of each month" });
  await expect(months.getByRole("listitem")).toHaveCount(12);
  await expect(page.getByText("This is math, not a recommendation.")).toBeVisible();
  await expect(page.getByText(/recommend(ed)? (the|this)|you should|you can afford/i)).toHaveCount(
    0,
  );

  // The URL is the whole state: opening it again shows the same answer.
  const answer = await page.getByText(/^Safe to spend/).textContent();
  await page.goto(page.url());
  await expect(page.getByText(/^Safe to spend/)).toHaveText(answer ?? "");

  await page.goto("/afford?kind=more&amount=40");
  await expect(months.getByRole("listitem")).toHaveCount(12);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

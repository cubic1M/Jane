import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Spec step 109: every debt in one place, from the demo bank: loans and cards with where
// each rate came from, the buy now, pay later plans found from payments, terms typed for
// what the bank leaves out, and the same answer in Jane's chat.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("every debt shows with its source, and missing terms can be typed in", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("How much do I owe?");
  await ask.press("Enter");
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(messages.last()).toContainText("the same as your net worth counts");
  await expect(messages.last()).toContainText("Klarna Pay in 4");
  await messages.last().getByRole("link", { name: "See every debt" }).click();

  await expect(page).toHaveURL(/\/loans/);
  await expect(page.getByRole("heading", { level: 1, name: "Every debt" })).toBeVisible();
  const loans = page.getByRole("list", { name: "Loans and cards" });
  const plans = page.getByRole("list", { name: "Buy now, pay later plans" });
  const car = loans.getByRole("listitem").filter({ hasText: "Demo Car Loan ····0006" });
  await expect(car).toContainText("6.90% fixed");
  await expect(car).toContainText("from your bank");
  const klarna = plans.getByRole("listitem").filter({ hasText: "Klarna Pay in 4" });
  await expect(klarna).toContainText("2 of 4 payments made");
  await expect(klarna).toContainText("no interest under the company's own terms");

  const affirm = plans.getByRole("listitem").filter({ hasText: "Affirm plan" });
  await affirm.getByText("Add what your bank doesn't report").click();
  await affirm.getByLabel("Rate (APR %)").fill("15");
  await affirm.getByLabel("Left to pay ($)").fill("537");
  await affirm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. Jane counts it from now on.");
  await expect(affirm).toContainText("15.00%");
  await expect(affirm).toContainText("you typed it on");
});

// Spec step 110: the plan across every debt, Jane's pick as labelled demo advice, started
// with one tap from the page.
test("the payoff plan picks an order for the demo bank and starts with one tap", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  await page.goto("/debt");
  const plan = page.getByRole("region", { name: "Your way out of debt" });
  await expect(plan).toContainText("Jane's pick: highest rate first");
  await expect(plan.getByRole("listitem").first()).toHaveText("Demo Credit Card ····0003");
  await expect(plan.getByRole("note")).toHaveText("Demo advice: sample data, not financial advice");
  await expect(plan.getByRole("table", { name: "Paying more each month" })).toBeVisible();
  await plan.getByRole("button", { name: "Start this plan" }).click();
  await expect(page.getByRole("status")).toContainText("Started. Jane checks it every month");
  await expect(page.getByRole("region", { name: "Your way out of debt" })).toContainText(
    "This is your plan (highest rate first).",
  );
  // The planner below starts from the same debts.
  await expect(page.getByLabel("Card or loan").first()).toHaveValue(/Demo/);
});

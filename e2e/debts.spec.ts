import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, setCheckingBalance, signedInUser } from "./db";

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

// Spec step 111: refinance offers from the stand-in lender catalog, compared over the same
// months with fees, the pick labelled as demo advice.
test("refinance offers compare total cost and pick one, labelled", async ({
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

  await page.goto("/loans");
  await page.getByRole("link", { name: "See refinance offers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Refinance offers" })).toBeVisible();
  await expect(page.getByText("sample offers from a stand-in lender catalog")).toBeVisible();
  const car = page
    .getByRole("list", { name: "Offers by debt" })
    .getByRole("listitem")
    .filter({ hasText: "Demo Car Loan" });
  await expect(car).toContainText("Jane's pick: Harbor Auto Refi");
  await expect(car.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  await expect(car.getByRole("table")).toContainText("In all, with fees");
  await page.getByRole("button", { name: "Check rates now" }).click();
  await expect(page.getByRole("status")).toHaveText("Checked just now.");
});

// Spec step 112: apply from the offers page; the terms must be reviewed before submitting.
test("apply prepares the application, and it's sent only once the terms are reviewed", async ({
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

  await page.goto("/loans/refinance");
  await page.getByRole("button", { name: "Apply with Harbor Auto Refi" }).click();
  await expect(page).toHaveURL(/\/loans\/apply\//);
  await expect(page.getByRole("heading", { level: 1, name: "Loan application" })).toBeVisible();
  await expect(page.getByText("Ready for you to review and submit")).toBeVisible();
  // Submit needs the terms reviewed (the server refuses without it too).
  await expect(page.getByLabel("I've reviewed the terms above")).toHaveAttribute("required", "");
  // By keyboard: on a phone the fixed bottom navigation can sit over these while the page
  // settles, and the keyboard doesn't depend on what's on top.
  await page.getByLabel("I've reviewed the terms above").press("Space");
  await expect(page.getByLabel("I've reviewed the terms above")).toBeChecked();
  await page.getByRole("button", { name: "Submit the application" }).press("Enter");
  await expect(page.getByText("Approved by Harbor Auto Refi: waiting for your yes.")).toBeVisible();
  await page.getByRole("button", { name: "Accept the loan" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Accepted.");
  await expect(page.getByRole("list", { name: "Steps" })).toContainText("Accepted:");
});

// Spec step 113: a 0% balance transfer, fee counted; telling Jane it's done puts the end
// on the deadlines.
test("a 0% transfer counts its fee and is tracked once moved", async ({
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

  await page.goto("/loans/refinance#transfers");
  const section = page.getByRole("region", { name: "Move card debt to 0%" });
  await expect(section).toContainText("Saving, fee counted");
  await expect(section).toContainText("transfer fee is counted");
  await section.getByRole("button", { name: /^I've moved it to / }).press("Enter");
  await expect(page.getByRole("status")).toContainText("The 0% end is on your deadlines");
  // The deadline shows on /deadlines from 90 days before the end (unit tests check it's saved).
  await expect(page.getByRole("list", { name: "Your transfers" })).toContainText("0% until");
});

// Spec step 114: student loan plans compared, with the official steps linked.
test("student loan plans are compared, and every step links to studentaid.gov", async ({
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

  await page.goto("/loans");
  await page.getByRole("link", { name: "Compare its repayment plans" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Student loans" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Repayment plans" })).toContainText(
    "Repayment Assistance Plan (RAP)",
  );
  const steps = page.getByRole("list", { name: "Steps on studentaid.gov" }).getByRole("link");
  await expect(steps).toHaveCount(5);
  for (const href of await steps.evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    expect(href).toMatch(/^https:\/\/studentaid\.gov\//);
  }
  await page.getByLabel("Income from your last tax return ($)").fill("45000");
  await page.getByLabel("I work full time in public service").press("Space");
  await page.getByRole("button", { name: "Save" }).press("Enter");
  await expect(page.getByRole("status")).toHaveText(
    "Saved. The plans are worked out again with it.",
  );
  await expect(page.getByText(/toward Public Service Loan Forgiveness/)).toBeVisible();
});

// Spec step 115: the mortgage page: PMI waits for the home's value; escrow and extra
// principal from the demo bank.
test("the mortgage page shows PMI, the escrow change and extra principal", async ({
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

  await page.goto("/loans");
  await page.getByRole("link", { name: "See PMI, escrow and extra payments" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mortgage" })).toBeVisible();
  const pmi = page.getByRole("region", { name: "Private mortgage insurance (PMI)" });
  await expect(pmi).toContainText("Your loan has PMI.");
  await expect(pmi.getByRole("link", { name: "the CFPB" })).toHaveAttribute(
    "href",
    /consumerfinance\.gov/,
  );
  await expect(page.getByRole("region", { name: "Escrow" })).toContainText("$2,198.31");
  await expect(page.getByRole("table", { name: "Extra principal each month" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Refinancing" })).toContainText(
    "It doesn't pay now",
  );
});

// Spec step 116: the stand-in credit score, labelled, with what's helping and hurting.
test("the credit score is a labelled stand-in, with its factors and card use", async ({
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

  await page.goto("/loans");
  await page.getByRole("link", { name: "See your credit score" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Credit score" })).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "not your real credit score" }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Factors" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "Card use" })).toContainText("of your card limits");
});

// Spec step 174: what each card earns on the person's own spending, the fee counted, and a
// better card applied for with one tap, labelled as demo advice.
test("card rewards count the fee, and a better card is applied for with one tap", async ({
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

  await page.goto("/loans");
  await page.getByRole("link", { name: "See your card rewards" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Card rewards" })).toBeVisible();
  await expect(page.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your cards" })).toContainText(
    "The fee doesn't pay for itself",
  );
  const apply = page.getByRole("button", { name: /^Apply for the / });
  await apply.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await apply.focus();
  await apply.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Sent just now.");
  await expect(page.getByRole("region", { name: "Your applications" })).toContainText("Approved");
});

// Spec step 175: the score simulator is labelled an estimate, and the payment before the
// statement closes is shown with its tap.
test("building credit shows the simulator as an estimate and the statement payment", async ({
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

  await page.goto("/loans/credit");
  const build = page.getByRole("region", { name: "Build your credit" });
  await expect(build).toBeVisible();
  await expect(build.getByRole("table", { name: "Score simulator" })).toBeVisible();
  await expect(build.getByRole("note")).toContainText("nothing changes until you act");
  await expect(build.getByRole("group", { name: "Before the statement" })).toContainText(
    "statement closes on",
  );
});

// Spec step 176: every buy now, pay later installment from the plans' own schedules.
test("buy now, pay later installments are listed from the plans' schedules", async ({
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

  await page.goto("/loans");
  const list = page.getByRole("list", { name: "Installments coming" });
  await expect(list).toBeVisible();
  await expect(list).toContainText("$62.25 to Klarna Pay in 4");
  await expect(list).toContainText("$89.50 to Affirm plan");
});

// Spec step 177: a tight month's plan, with essentials first and each request sent on a tap.
test("a tight month shows the plan, and a request is sent only on the tap", async ({
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
  await setCheckingBalance(user.userId, 30_000);

  await page.goto("/loans/tight");
  await expect(page.getByRole("heading", { level: 1, name: "When money is tight" })).toBeVisible();
  await expect(page.getByRole("status").first()).toContainText("Checking is forecast to be");
  await expect(page.getByRole("list", { name: "Bills in order" })).toBeVisible();
  const requests = page.getByRole("list", { name: "Requests" }).getByRole("listitem");
  await expect(requests.first()).toBeVisible();
  const send = page.getByRole("button", { name: "Send this request" }).first();
  await send.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await send.focus();
  await send.press("Enter");
  await expect(page.getByText("Sent just now.")).toBeVisible();
  await expect(requests.first()).toContainText("Sent, answer in about 2 days");
});

// Spec step 178: what car fits, with insurance and running costs in, and a dealer's offer
// checked against the preapprovals.
test("buying a car shows the all-in cost, preapprovals and a dealer check", async ({
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

  await page.goto("/loans/car?price=30000&dealerApr=8.99&dealerMonths=60");
  await expect(page.getByRole("heading", { level: 1, name: "Buying a car" })).toBeVisible();
  const costs = page.getByRole("table", { name: "Monthly cost" });
  await expect(costs).toContainText("Insurance");
  await expect(costs).toContainText("Fuel");
  await expect(costs).toContainText("All in");
  await expect(
    page.getByRole("list", { name: "Offers" }).getByRole("listitem").first(),
  ).toContainText("cheapest");
  await expect(page.getByRole("status")).toContainText("more than the best preapproval");
  await expect(page.getByRole("region", { name: "Assumptions" })).toContainText("Income:");
});

// Spec step 179: from saving to closing, with every assumption shown and the goal started
// only on the tap.
test("buying a home shows the plan, its assumptions, and starts the goal on the tap", async ({
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

  await page.goto("/loans/home?price=400000");
  await expect(page.getByRole("heading", { level: 1, name: "Buying a home" })).toBeVisible();
  const costs = page.getByRole("table", { name: "Monthly cost" });
  await expect(costs).toContainText("Mortgage insurance (PMI)");
  await expect(page.getByRole("region", { name: "Saving for it" })).toContainText("$52,000.00");
  await expect(page.getByRole("region", { name: "Assumptions" })).toContainText("28%");
  const start = page.getByRole("button", { name: /^Start a \$52,000\.00 goal/ });
  await start.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await start.focus();
  await start.press("Enter");
  await expect(page.getByText("Started just now.")).toBeVisible();
  await page.goto("/goals");
  await expect(page.getByText("Home down payment")).toBeVisible();
});

// Spec step 180: a medical bill found in payments plus one typed in, with the letters
// written and sent only on the tap.
test("medical bills are found, letters are written, and a request is sent only on the tap", async ({
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

  await page.goto("/loans/medical");
  await expect(page.getByRole("heading", { level: 1, name: "Medical bills" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Bills" })).toContainText("$180.00");

  await page.getByLabel("From").fill("Mercy Hospital");
  await page.getByLabel("Amount").fill("2400");
  await page.getByLabel("Date on the bill").fill("2026-09-01");
  await page.getByRole("button", { name: "Add this bill" }).press("Enter");
  await expect(page.getByText("Added.")).toBeVisible();
  const mercy = page.getByRole("list", { name: "Requests for Mercy Hospital" });
  await expect(mercy).toContainText("financial assistance");
  await expect(mercy).toContainText("no interest");

  const send = mercy.getByRole("button", { name: "Send this request" }).first();
  await send.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await send.focus();
  await send.press("Enter");
  await expect(page.getByText("Sent just now.")).toBeVisible();
  await expect(mercy).toContainText("Sent, answer in about 2 days");
});

// Spec step 181: a collection and an error found on the stand-in report, with letters citing
// the rule and deadline, sent only on the tap.
test("report fixes show the letters with their rules, and a letter is sent only on the tap", async ({
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

  await page.goto("/loans/report");
  await expect(
    page.getByRole("heading", { level: 1, name: "Fix your credit report" }),
  ).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "stand-in report" })).toBeVisible();
  const items = page.getByRole("list", { name: "Items" });
  await expect(items).toContainText("Northstar Recovery");
  await expect(items).toContainText("Fair Debt Collection Practices Act");
  await expect(items).toContainText("Fair Credit Reporting Act");
  await expect(items).toContainText("The last day to ask is");

  const letters = page.getByRole("list", { name: "Letters for Northstar Recovery" });
  const send = letters.getByRole("button", { name: "Send this letter" }).first();
  await send.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await send.focus();
  await send.press("Enter");
  await expect(page.getByText("Sent just now.")).toBeVisible();
  await expect(letters).toContainText("answer due by");
  await page.goto("/deadlines");
  await expect(page.getByText("Collector's validation due: Northstar Recovery")).toBeVisible();
});

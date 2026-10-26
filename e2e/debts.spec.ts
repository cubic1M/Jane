import { expect, test, type Page } from "@playwright/test";
import { isHiddenPage } from "../src/config/hidden-pages";
import { pickItem } from "./area-tree";
import {
  E2E_DATABASE_URL,
  addPayment,
  addTransfer,
  deleteUser,
  setCheckingBalance,
  signedInUser,
} from "./db";
import { CHAT, landInChat } from "./chat-page";

// Page text is looked for in <main>: on a computer Jane's pop-up cards sit beside the page
// (the side chat's dock) and can carry the same words.

// A loans and credit page from the /loans tree's list of every page (docs/design/area-pages.md).
async function openLoansPage(page: Page, link: string) {
  await page.goto("/loans");
  await page.getByRole("main").getByText("All loans and credit pages").click();
  await page
    .getByRole("list", { name: "All loans and credit pages" })
    .getByRole("link", { name: link })
    .click();
}

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
  await landInChat(page, 60_000);

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("How much do I owe?");
  await ask.press("Enter");
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(messages.last()).toContainText("the same as your net worth counts");
  await expect(messages.last()).toContainText("Klarna Pay in 4");
  await messages.last().getByRole("link", { name: "See every debt" }).click();

  await expect(page).toHaveURL(/\/loans/);
  await expect(page.getByRole("heading", { level: 1, name: "Every debt" })).toBeVisible();
  // Each debt is an item of the tree's "Your debts" branch, its card in the detail.
  const debts = "Your debts";
  const car = (await pickItem(page, "Loans & credit", debts, "Demo Car Loan ····0006"))
    .getByRole("list", { name: "Loans and cards" })
    .getByRole("listitem");
  await expect(car).toContainText("6.90% fixed");
  await expect(car).toContainText("from your bank");
  const klarna = (await pickItem(page, "Loans & credit", debts, "Klarna Pay in 4"))
    .getByRole("list", { name: "Buy now, pay later plans" })
    .getByRole("listitem");
  await expect(klarna).toContainText("2 of 4 payments made");
  await expect(klarna).toContainText("no interest under the company's own terms");

  const affirm = () =>
    pickItem(page, "Loans & credit", debts, "Affirm plan").then((r) =>
      r.getByRole("list", { name: "Buy now, pay later plans" }).getByRole("listitem"),
    );
  const plan = await affirm();
  await plan.getByText("Add what your bank doesn't report").click();
  await plan.getByLabel("Rate (APR %)").fill("15");
  await plan.getByLabel("Left to pay ($)").fill("537");
  await plan.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Saved. Jane counts it from now on.",
  );
  const saved = await affirm();
  await expect(saved).toContainText("15.00%");
  await expect(saved).toContainText("you typed it on");
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
  await landInChat(page, 60_000);

  await page.goto("/debt");
  const plan = page.getByRole("region", { name: "Your way out of debt" });
  await expect(plan).toContainText("Jane's pick: highest rate first");
  await expect(plan.getByRole("listitem").first()).toHaveText("Demo Credit Card ····0003");
  await expect(plan.getByRole("note")).toHaveText("Demo advice: sample data, not financial advice");
  await expect(plan.getByRole("table", { name: "Paying more each month" })).toBeVisible();
  await plan.getByRole("button", { name: "Start this plan" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "Started. Jane checks it every month",
  );
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
  await landInChat(page, 60_000);

  await openLoansPage(page, "See refinance offers");
  // The first visit asks the stand-in lenders and compiles the page: give it time.
  await expect(page.getByRole("heading", { level: 1, name: "Refinance offers" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.getByRole("main").getByText("sample offers from a stand-in lender catalog"),
  ).toBeVisible();
  const car = page
    .getByRole("list", { name: "Offers by debt" })
    .getByRole("listitem")
    .filter({ hasText: "Demo Car Loan" });
  await expect(car).toContainText("Jane's pick: Harbor Auto Refi");
  await expect(car.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  await expect(car.getByRole("table")).toContainText("In all, with fees");
  // Loans QA: the card the demo person's cash pays off for less than any loan isn't refinanced.
  const card = page
    .getByRole("list", { name: "Offers by debt" })
    .getByRole("listitem")
    .filter({ hasText: "Demo Credit Card" });
  await expect(card).toContainText("Jane's pick: pay it off from your cash");
  await expect(card.getByRole("button", { name: /^Apply with/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Check rates now" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Checked just now.");
});

// Spec step 112: apply from the offers page; the terms must be reviewed before submitting.
test("apply prepares the application, and it's sent only once the terms are reviewed", async ({
  context,
  page,
  baseURL,
}) => {
  // The application page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/apply/:id"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/refinance");
  await page.getByRole("button", { name: "Apply with Harbor Auto Refi" }).click();
  await expect(page).toHaveURL(/\/loans\/apply\//);
  await expect(page.getByRole("heading", { level: 1, name: "Loan application" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Ready for you to review and submit"),
  ).toBeVisible();
  // Submit needs the terms reviewed (the server refuses without it too).
  await expect(page.getByLabel("I've reviewed the terms above")).toHaveAttribute("required", "");
  // By keyboard: on a phone the fixed bottom navigation can sit over these while the page
  // settles, and the keyboard doesn't depend on what's on top.
  await page.getByLabel("I've reviewed the terms above").press("Space");
  await expect(page.getByLabel("I've reviewed the terms above")).toBeChecked();
  await page.getByRole("button", { name: "Submit the application" }).press("Enter");
  await expect(
    page.getByRole("main").getByText("Approved by Harbor Auto Refi: waiting for your yes."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept the loan" }).press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toContainText("Accepted.");
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
  await landInChat(page, 60_000);

  await page.goto("/loans/refinance#transfers");
  const section = page.getByRole("region", { name: "Move card debt to 0%" });
  await expect(section).toContainText("Saving, fee counted");
  await expect(section).toContainText("transfer fee is counted");
  await section.getByRole("button", { name: /^I've moved it to / }).press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "The 0% end is on your deadlines",
  );
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
  await landInChat(page, 60_000);

  await openLoansPage(page, "Compare its repayment plans");
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
  await page.getByRole("button", { name: "Save", exact: true }).press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Saved. The plans are worked out again with it.",
  );
  await expect(
    page.getByRole("main").getByText(/toward Public Service Loan Forgiveness/),
  ).toBeVisible();
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
  await landInChat(page, 60_000);

  await openLoansPage(page, "See PMI, escrow and extra payments");
  await expect(page.getByRole("heading", { level: 1, name: "Your mortgage" })).toBeVisible();
  const pmi = page.getByRole("region", { name: "Private mortgage insurance (PMI)" });
  // One PMI rule, as /loans/equity: the home's value when the loan began, not today's (asked
  // there, so not while that page is hidden in the read-only beta).
  if (!isHiddenPage("/loans/equity"))
    await expect(pmi).toContainText("Tell Jane the home's value when the loan began");
  else await expect(pmi).toContainText("Your loan has PMI.");
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
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/credit"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await openLoansPage(page, "See your credit score");
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
  await landInChat(page, 60_000);

  await openLoansPage(page, "See your card rewards");
  await expect(page.getByRole("heading", { level: 1, name: "Card rewards" })).toBeVisible();
  // The page's own label (a pop-up card may carry the same words).
  await expect(page.locator("[data-demo-advice]").first()).toHaveText(
    "Demo advice: sample data, not financial advice",
  );
  await expect(page.getByRole("region", { name: "Your cards" })).toContainText(
    "The fee doesn't pay for itself",
  );
  const apply = page.getByRole("button", { name: /^Apply for the / });
  await apply.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await apply.focus();
  await apply.press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Sent just now.");
  await expect(page.getByRole("region", { name: "Your applications" })).toContainText("Approved");
});

// Spec step 175: the score simulator is labelled an estimate, and the payment before the
// statement closes is shown with its tap.
test("building credit shows the simulator as an estimate and the statement payment", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/credit"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

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
  await landInChat(page, 60_000);

  await page.goto("/loans");
  const installments = await pickItem(page, "Loans & credit", "Your debts", "Installments coming");
  const list = installments.getByRole("list", { name: "Installments coming" });
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
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/tight"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);
  await setCheckingBalance(user.userId, 30_000);

  await page.goto("/loans/tight");
  await expect(page.getByRole("heading", { level: 1, name: "When money is tight" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("status").first()).toContainText(
    "Checking is forecast to be",
  );
  await expect(page.getByRole("list", { name: "Bills in order" })).toBeVisible();
  const requests = page.getByRole("list", { name: "Requests" }).getByRole("listitem");
  await expect(requests.first()).toBeVisible();
  const send = page.getByRole("button", { name: "Send this request" }).first();
  await send.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await send.focus();
  await send.press("Enter");
  await expect(page.getByRole("main").getByText("Sent just now.")).toBeVisible();
  await expect(requests.first()).toContainText("Sent, answer in about 2 days");
});

// Spec step 178: what car fits, with insurance and running costs in, and a dealer's offer
// checked against the preapprovals.
test("buying a car shows the all-in cost, preapprovals and a dealer check", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/car"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/car?price=30000&dealerApr=8.99&dealerMonths=60");
  await expect(page.getByRole("heading", { level: 1, name: "Buying a car" })).toBeVisible();
  const costs = page.getByRole("table", { name: "Monthly cost" });
  await expect(costs).toContainText("Insurance");
  await expect(costs).toContainText("Fuel");
  await expect(costs).toContainText("All in");
  await expect(
    page.getByRole("list", { name: "Offers" }).getByRole("listitem").first(),
  ).toContainText("cheapest");
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "more than the best preapproval",
  );
  await expect(page.getByRole("region", { name: "Assumptions" })).toContainText("Income:");
});

// Spec step 179: from saving to closing, with every assumption shown and the goal started
// only on the tap.
test("buying a home shows the plan, its assumptions, and starts the goal on the tap", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/home"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/home?price=400000");
  await expect(page.getByRole("heading", { level: 1, name: "Buying a home" })).toBeVisible();
  const costs = page.getByRole("table", { name: "Monthly cost" });
  await expect(costs).toContainText("Mortgage insurance (PMI)");
  await expect(page.getByRole("region", { name: "Saving for it" })).toContainText("$52,000.00");
  await expect(page.getByRole("region", { name: "Assumptions" })).toContainText("28%");
  // Loans QA: the 28/36 home and what you could borrow, said together with why they differ.
  await expect(
    page.getByRole("main").getByText(/^Two measures, two sizes: the usual 28\/36 rules/),
  ).toBeVisible();
  const start = page.getByRole("button", { name: /^Start a \$52,000\.00 goal/ });
  await start.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await start.focus();
  await start.press("Enter");
  await expect(page.getByRole("main").getByText("Started just now.")).toBeVisible();
  await page.goto("/goals");
  await expect(page.getByRole("main").getByText("Home down payment")).toBeVisible();
});

// Spec step 180: a medical bill found in payments plus one typed in, with the letters
// written and sent only on the tap.
test("medical bills are found, letters are written, and a request is sent only on the tap", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/medical"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/medical");
  await expect(page.getByRole("heading", { level: 1, name: "Medical bills" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Bills" })).toContainText("$180.00");

  await page.getByLabel("From").fill("Mercy Hospital");
  await page.getByLabel("Amount").fill("2400");
  await page.getByLabel("Date on the bill").fill("2026-09-01");
  await page.getByRole("button", { name: "Add this bill" }).press("Enter");
  await expect(page.getByRole("main").getByText("Added.")).toBeVisible();
  const mercy = page.getByRole("list", { name: "Requests for Mercy Hospital" });
  await expect(mercy).toContainText("financial assistance");
  await expect(mercy).toContainText("no interest");

  const send = mercy.getByRole("button", { name: "Send this request" }).first();
  await send.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await send.focus();
  await send.press("Enter");
  await expect(page.getByRole("main").getByText("Sent just now.")).toBeVisible();
  await expect(mercy).toContainText("Sent, answer in about 2 days");
});

// Spec step 181: a collection and an error found on the stand-in report, with letters citing
// the rule and deadline, sent only on the tap.
test("report fixes show the letters with their rules, and a letter is sent only on the tap", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/report"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

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
  await expect(page.getByRole("main").getByText("Sent just now.")).toBeVisible();
  await expect(letters).toContainText("answer due by");
  await page.goto("/deadlines");
  await expect(
    page.getByRole("main").getByText("Collector's validation due: Northstar Recovery"),
  ).toBeVisible();
});

// Spec step 224: card interest, a 0% promotion off pace, and a request for a lower rate sent
// only on the tap.
test("card interest shows the cost, a promotion off pace, and a request sent on the tap", async ({
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
  await landInChat(page, 60_000);

  await page.goto("/loans/interest");
  await expect(page.getByRole("heading", { level: 1, name: "Less card interest" })).toBeVisible();
  const cards = page.getByRole("list", { name: "Cards" });
  await expect(cards).toContainText("$2,410.50 at 22.99%");
  await expect(cards).toContainText("a year in interest");

  await page.getByLabel("Card", { exact: true }).fill("Home Goods Store Card");
  await page.getByLabel("Left to clear").fill("5000");
  await page.getByLabel("Rate after the promotion %").fill("26.99");
  await page.getByLabel("Started").fill("2026-06-01");
  await page.getByLabel("Ends").fill("2099-02-01");
  await page.getByRole("button", { name: "Add this promotion" }).press("Enter");
  await expect(page.getByRole("main").getByText("Promotion added.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Promotions" })).toContainText("0% ends on");

  const send = page.getByRole("button", { name: "Send this request" }).first();
  await send.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await send.focus();
  await send.press("Enter");
  await expect(page.getByRole("main").getByText("Sent just now.")).toBeVisible();
  await expect(cards).toContainText("Asked");
});

// Spec step 225: the long game on student loans: PSLF month by month, the dates that become
// deadlines, and what a refinance would give up.
test("student loans show PSLF month by month, save dates as deadlines, and warn about refinancing", async ({
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
  await landInChat(page, 60_000);

  await page.goto("/loans/student");
  await page.getByLabel("I work full time in public service").check();
  await page.getByLabel("Qualifying payments already counted").fill("90");
  await page.getByRole("button", { name: "Save", exact: true }).press("Enter");
  await expect(
    page.getByRole("main").getByText("Saved. The plans are worked out again with it."),
  ).toBeVisible();

  const game = page.getByRole("region", { name: "The long game" });
  await expect(game).toContainText("qualifying payments counted for PSLF");
  await expect(game.getByRole("list", { name: "PSLF months" }).getByRole("listitem")).toHaveCount(
    13,
  );
  await expect(game.getByRole("note")).toContainText("Don't refinance a federal loan");
  await expect(game.getByRole("list", { name: "What a refinance would give up" })).toBeVisible();

  await game.getByLabel("Employer last certified").fill("2025-01-15");
  const inSixMonths = new Date(Date.now() + 183 * 86_400_000).toISOString().slice(0, 10);
  await game.getByLabel("Income-driven plan recertified by").fill(inSixMonths);
  await game.getByRole("button", { name: "Save my dates" }).press("Enter");
  await expect(
    page.getByRole("main").getByText("Saved. The dates are on your deadlines."),
  ).toBeVisible();
  await page.goto("/deadlines");
  await expect(
    page.getByRole("main").getByText("Certify your employer for Public Service Loan Forgiveness"),
  ).toBeVisible();
});

// Spec step 226: a payment-app transfer is a loan only after the person says so; Jane drafts
// a reminder but never messages the other person.
test("a payment-app transfer is a loan only after the tap, and the reminder is only text", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/family"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);
  const day = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  await addTransfer(user.userId, {
    date: day(45),
    amountCents: 40_000,
    description: "VENMO PAYMENT TO JORDAN LEE - rent loan",
  });

  await page.goto("/loans/family");
  await expect(page.getByRole("heading", { level: 1, name: "Family and friends" })).toBeVisible();
  const asks = page.getByRole("list", { name: "Transfers" });
  await expect(asks).toContainText("You sent Jordan Lee $400.00 on Venmo");
  await expect(asks).toContainText("I won't contact Jordan");
  await expect(page.getByRole("list", { name: "Loans" })).toHaveCount(0);

  const yes = asks.getByRole("button", { name: "Yes, I lent it" });
  await yes.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await yes.focus();
  await yes.press("Enter");
  await expect(page.getByRole("main").getByText("Noted.")).toBeVisible();
  const loans = page.getByRole("list", { name: "Loans" });
  await expect(loans).toContainText("Jordan Lee owes you $400.00");
  await expect(loans.getByRole("note")).toContainText("A kind reminder, for you to send");
  await expect(loans.getByRole("note")).toContainText("Hi Jordan");
});

// Spec step 227: a credit score needed by a date: a monthly plan from the simulator, labelled
// an estimate, started on a tap, with a checklist to tick off.
test("a credit score goal is previewed, started on the tap, and ticked off month by month", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(
    isHiddenPage("/loans/credit") || isHiddenPage("/loans/goal"),
    "hidden in the read-only beta",
  );
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);
  const inSix = new Date(Date.now() + 183 * 86_400_000).toISOString().slice(0, 10);

  await page.goto("/loans/credit");
  await expect(page.getByRole("heading", { level: 1, name: "Credit score" })).toBeVisible();
  await page.goto(`/loans/goal?kind=mortgage&score=740&date=${inSix}`);
  await expect(
    page.getByRole("note").filter({ hasText: "estimates from the stand-in" }),
  ).toBeVisible();
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByRole("status")).toContainText("Reachable");
  await expect(preview.getByRole("table", { name: "Plan by month" })).toBeVisible();

  const start = page.getByRole("button", { name: "Start this plan" });
  await start.scrollIntoViewIfNeeded();
  // Keyboard, so the fixed bottom nav on phones never takes the tap.
  await start.focus();
  await start.press("Enter");
  await expect(page.getByRole("main").getByText("Plan started.")).toBeVisible();
  const list = page.getByRole("list", { name: "This month's list" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  const mark = list.getByRole("button", { name: "Mark done" }).first();
  await mark.scrollIntoViewIfNeeded();
  await mark.focus();
  await mark.press("Enter");
  await expect(page.getByRole("main").getByText("Ticked off.")).toBeVisible();
  await expect(list.getByText("Done", { exact: true })).toHaveCount(1);
});

// Spec step 228: PMI against the original value with a drafted request, escrow against the
// real bills, and a home project compared three ways with total cost.
test("a home loan's PMI, escrow and project are worked out from what the person tells Jane", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/equity"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/equity");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your home loan, used well" }),
  ).toBeVisible();
  const facts = page.getByRole("region", { name: "What you know" });
  await facts.getByLabel("Home's value when the loan began").fill("395000");
  await facts.getByLabel("Property tax, a year").fill("1800");
  await facts.getByLabel("Homeowners insurance, a year").fill("800");
  const save = facts.getByRole("button", { name: "Save", exact: true });
  await save.focus();
  await save.press("Enter");
  await expect(page.getByRole("main").getByText("Saved.")).toBeVisible();

  const pmi = page.getByRole("region", { name: "PMI" });
  await expect(pmi).toContainText("79.1% of the home's original value of $395,000.00");
  await expect(pmi.getByLabel("Drafted PMI request")).toContainText(
    "cancel the private mortgage insurance",
  );
  const escrow = page.getByRole("region", { name: "Escrow" });
  await expect(escrow).toContainText("Your tax and insurance bills come to $2,600.00 a year");
  await expect(escrow.getByLabel("Drafted escrow request")).toContainText("refund");

  const sent = pmi.getByRole("button", { name: "I sent the PMI request" });
  await sent.scrollIntoViewIfNeeded();
  await sent.focus();
  await sent.press("Enter");
  await expect(page.getByRole("main").getByText("Noted that you sent it.")).toBeVisible();
  await expect(page.getByRole("region", { name: "PMI" })).toContainText("You sent this on");

  const project = page.getByRole("region", { name: "A home project" });
  await project.getByLabel("What it costs").fill("40000");
  const compare = project.getByRole("button", { name: "Compare" });
  await compare.focus();
  await compare.press("Enter");
  const table = page.getByRole("table", { name: "Ways to pay" });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("Home equity line of credit (HELOC)");
  await expect(table).toContainText("Cash-out refinance");
  await expect(table).toContainText("Personal loan");
  await expect(
    page.getByRole("main").getByText("stand-in lender terms, not offers", { exact: false }),
  ).toBeVisible();
});

// Spec step 229: the options when debt is too much, as facts, without advice.
test("the options when debt is too much are laid out as facts, with the pointer to counsel", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/help"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/help");
  await expect(
    page.getByRole("heading", { level: 1, name: "When debt is too much" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("status")).toContainText("of your");
  const hardship = page.getByRole("region", { name: "Hardship programs" });
  await expect(hardship).toContainText("hardship program");
  await expect(hardship).toContainText("forbearance");
  const plan = page.getByRole("region", { name: "Debt management plan" });
  await expect(plan).toContainText("nonprofit credit counselor");
  await expect(
    plan.getByRole("link", { name: /National Foundation for Credit Counseling/ }),
  ).toBeVisible();
  const facts = page.getByRole("region", { name: "Settlement and bankruptcy" });
  await expect(facts.getByRole("list", { name: "Bankruptcy" }).getByRole("listitem")).toHaveCount(
    3,
  );
  await expect(facts.getByRole("list", { name: "Taxes on forgiven debt" })).toContainText("$600");
  await expect(facts.getByRole("note")).toContainText("ask a bankruptcy attorney");
  // Facts only: nothing to send, nothing to apply for.
  await expect(page.getByRole("button", { name: /send|apply|file/i })).toHaveCount(0);
});

// Spec step 230: the yearly debt review: every item with its status, and in the chat one
// message whose buttons each stay until used.
test("the debt review lists every item, and the chat message keeps each button until it's used", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/review"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/review");
  await expect(page.getByRole("heading", { level: 1, name: "Your debt review" })).toBeVisible();
  // Linking the bank did the first review (or it's about to be: Jane's pass may still be running).
  await expect(page.getByRole("main").getByRole("status")).toContainText(/first debt review/i);
  const items = page.getByRole("list", { name: "Review items" }).getByRole("listitem");
  await expect(items.first()).toContainText("Payments timed to statement dates");
  await expect(items.getByRole("heading", { name: "0% promotions on pace" })).toBeVisible();
  await expect(items.getByRole("heading", { name: "Lower-rate requests" })).toBeVisible();
  await expect(items.getByRole("heading", { name: "PMI and escrow" })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "At your level" })).toBeVisible();
  // Spec step 251: this month's credit check-up, done after Jane's soft checks.
  const month = page.getByRole("region", { name: "This month's check-up" });
  await expect(month.getByRole("heading", { name: "Rates and what you could borrow" })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await expect(month.getByRole("heading", { name: "Costly borrowing" })).toBeVisible();
  await expect(month).toContainText("Every month, at your level:");
  // The lower card rate is shown once, in the review above (docs/feature-audit.md, cluster 14).
  await expect(month.getByRole("heading", { name: "A lower card rate" })).toHaveCount(0);

  // Asking in the chat shows the same items.
  await page.goto(CHAT);
  const box = page.getByRole("textbox", { name: "Message Jane" });
  await box.fill("do my yearly debt review");
  await box.press("Enter");
  await expect(page.getByRole("main").getByText("Your debt review:").last()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page
      .getByRole("main")
      .getByText(/Payments timed to statement dates/)
      .last(),
  ).toBeVisible();
});

// Spec step 245: a dealer add-on found in the payments, confirmed, with the refund and the
// cancellation to send or hand to the team.
test("a dealer add-on is confirmed, with its refund and a cancellation the team can send", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/auto"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  await addPayment(user.userId, {
    date: yearAgo,
    amountCents: 69_500,
    description: "BIG DEALER GAP INSURANCE",
  });

  await page.goto("/loans/auto");
  await expect(page.getByRole("heading", { level: 1, name: "Your car loan" })).toBeVisible();
  const section = page.getByRole("region", { name: "Dealer add-ons" });
  await expect(section).toContainText("$695.00 to BIG DEALER GAP INSURANCE");
  const yes = section.getByRole("button", { name: "Yes, it was" });
  await yes.scrollIntoViewIfNeeded();
  await yes.focus();
  await yes.press("Enter");
  await expect(page.getByRole("main").getByText("Done.")).toBeVisible();
  const addons = page.getByRole("list", { name: "Your add-ons" });
  await expect(addons).toContainText("Cancelling now could refund about");
  await expect(addons.getByLabel(/Cancellation letter/)).toContainText("cancel my GAP cover");
  const team = addons.getByRole("button", { name: "Have the team send it" });
  await team.scrollIntoViewIfNeeded();
  await team.focus();
  await team.press("Enter");
  await expect(page.getByRole("main").getByText("The team has this request.")).toBeVisible();
});

// Spec step 246: a lump sum compared as extra principal, a recast and a refinance, against
// investing it instead.
test("a lump sum is compared on the mortgage: extra principal, recast, refinance, investing", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/recast"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/recast");
  await expect(
    page.getByRole("heading", { level: 1, name: "Recast, refinance or pay extra" }),
  ).toBeVisible();
  await page.getByLabel("A lump sum").fill("20000");
  const compare = page.getByRole("button", { name: "Compare" });
  await compare.focus();
  await compare.press("Enter");
  const table = page.getByRole("table", { name: "The ways" });
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("Pay extra principal");
  await expect(table).toContainText("Recast the mortgage");
  await expect(table).toContainText("$250.00");
  await expect(table).toContainText("Not an option");
  await expect(
    page.getByRole("main").getByText(/Investing the same money for \d+ years instead/),
  ).toBeVisible();
  await expect(page.getByRole("main").getByText("Paying down earns your 4% rate")).toBeVisible();
});

// Spec step 247: costly short-term borrowing found in the demo bank, with the cost in dollars
// and as a yearly rate, and the cheaper ways out.
test("costly short-term borrowing is found, costed, and the way out is laid out", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/costly"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/costly");
  await expect(
    page.getByRole("heading", { level: 1, name: "Costly short-term borrowing" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("status")).toContainText("over the last year");
  const found = page.getByRole("list", { name: "What you paid" });
  await expect(found.getByRole("listitem")).toHaveCount(4);
  await expect(found).toContainText("Payday loans");
  await expect(found).toContainText("2 times, $30.00 in fees");
  await expect(found).toContainText("Card cash advances");
  await expect(found).toContainText("Overdraft fees");
  await expect(found).toContainText("Pay advance apps");
  const out = page.getByRole("region", { name: "Ways out" });
  await expect(out).toContainText("Credit union payday alternative loan (PAL)");
  await expect(out).toContainText("Build a small buffer");
});

// Spec step 248: a security deposit is followed to the day the state says it is due back, and
// rent reporting is never on by itself.
test("a deposit is followed to its due date and marked returned", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/renting"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/loans/renting");
  await expect(page.getByRole("heading", { level: 1, name: "Your rent" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("I don't see rent payments in your bank data yet."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Report my rent" })).toHaveCount(0);

  const deposits = page.getByRole("region", { name: "Security deposits" });
  await deposits.getByLabel("Deposit").fill("1500");
  await deposits.getByLabel("State").selectOption("NY");
  await deposits.getByLabel("Day you moved out").fill("2026-01-10");
  const follow = deposits.getByRole("button", { name: "Follow this deposit" });
  await follow.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Deposit saved.");
  await expect(deposits).toContainText("$1,500.00 deposit (NY)");
  await expect(deposits).toContainText("New York General Obligations Law § 7-108");

  await deposits.getByLabel(/Amount returned/).fill("1400");
  const back = deposits.getByRole("button", { name: "It came back" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Noted that it came back.");
  await expect(deposits).toContainText("returned $1,400.00");
});

// Spec step 249: a co-signed loan is recorded, counted in full against the person's own debt
// load, and a missed payment is shown as landing on them too.
test("a co-signed loan is counted in full and a missed payment lands on the person", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/helping"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await page.goto("/loans/helping");
  await expect(
    page.getByRole("heading", { level: 1, name: "Helping family with credit" }),
  ).toBeVisible();
  const cosign = page.getByRole("region", { name: "Co-signing" });
  await expect(cosign).toContainText("The lender can ask you for the whole balance");

  const told = page.getByRole("region", { name: "What you told me" });
  await told.getByLabel("For").fill("Jess");
  await told.getByLabel("Owed (co-signed)").fill("12000");
  await told.getByLabel("Payment a month").fill("300");
  const save = told.getByRole("button", { name: "Save" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Saved.");
  await expect(told).toContainText("Co-signed loan for Jess: $12,000.00 owed, $300.00 a month");
  await expect(cosign).toContainText("You've co-signed $12,000.00 in all, $300.00 a month.");

  const missed = told.getByRole("button", { name: "They missed a payment" });
  await missed.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Updated.");
  await expect(cosign).toContainText("Jess missed a payment: that's on your report too.");
});

// Spec step 250: what you could borrow, from soft checks, each figure dated, and checked again
// on a tap without applying for anything.
test("what you could borrow is shown with the day it was checked", async ({
  context,
  page,
  baseURL,
}) => {
  // Its page is hidden in the read-only beta (src/config/hidden-pages.ts).
  test.skip(isHiddenPage("/loans/borrow"), "hidden in the read-only beta");
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await landInChat(page, 60_000);

  await openLoansPage(page, "See what you could get, and at what rate");
  await expect(
    page.getByRole("heading", { level: 1, name: "What you could borrow" }),
  ).toBeVisible();
  // The page's own label (a pop-up card may carry the same words).
  await expect(page.locator("[data-demo-advice]").first()).toHaveText(
    "Demo advice: sample data, not financial advice",
  );
  // A card limit is a guess from a year of income, to the nearest $100.
  await expect(
    page.getByRole("main").getByText(/with a limit around \$[\d,]*00\.00/),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText(/^Two measures, two sizes: the usual 28\/36 rules/),
  ).toBeVisible();
  const list = page.getByRole("list", { name: "What you could borrow" });
  await expect(list.getByRole("listitem").filter({ has: page.getByRole("heading") })).toHaveCount(
    4,
  );
  await expect(list).toContainText("A mortgage");
  await expect(list).toContainText("A credit card");
  await expect(list.getByText(/^Checked \w+ \d+, \d{4}$/).first()).toBeVisible();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("main").getByRole("status")).toHaveText("Checked again just now.");
});

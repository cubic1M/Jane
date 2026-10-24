import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Investments (spec steps 128–137) on the demo bank: what the person owns, with sources,
// and Jane answering about it in the chat.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
// One long journey through every investments step (128 on), so more than the default.
test.setTimeout(300_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the demo bank's holdings show with their sources, and Jane answers about them", async ({
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

  // Step 128: what they own, adding up to net worth, every holding with its source.
  await page.goto("/investments");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Investments");
  // The page is a tree (docs/design/area-pages.md): each part is the detail of its item.
  const total = await pickItem(page, "Investing", "What you own", "In total");
  await expect(total.getByText("$96,730.55").first()).toBeVisible();
  const account = await pickItem(page, "Investing", "What you own", /401\(k\)/);
  await expect(account.getByText("Northstar Target 2055 Fund")).toBeVisible();
  await expect(
    account.getByText(/Source: Demo Bank \(fake data\), Demo 401\(k\), price as of/).first(),
  ).toBeVisible();
  // Step 295: each risk level replayed over sample history, as demo advice, never a forecast.
  await pickItem(page, "Investing", "Strategies", "Each level, replayed");
  const backtests = page.getByRole("region", { name: "How each risk level would have done" });
  await expect(backtests.getByText(/Replay of sample history since Jan 2, 2018/)).toBeVisible();
  await expect(backtests.getByText(/not a forecast/)).toBeVisible();
  await expect(backtests.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // The autopilot's own rules replayed against plain rebalancing and buy and hold, per level.
  await pickItem(page, "Investing", "Strategies", "Did the extra rules help?");
  const rules = page.getByRole("region", { name: "Did the extra rules help?" });
  await expect(rules.getByText(/Replay of sample history since Jan 2, 2018/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(rules.getByText(/not a forecast/)).toBeVisible();
  await expect(rules.getByText("Plain rebalancing").first()).toBeVisible();
  await expect(rules.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // The strategy each level follows (the research choice until the daily replay has run).
  await pickItem(page, "Investing", "Strategies", "The strategy each level follows");
  const strategies = page.getByRole("region", { name: "The strategy each level follows" });
  await expect(strategies.getByText(/Alpaca's real prices from Jan 4, 2016/)).toBeVisible();
  await expect(strategies.getByText(/not a forecast/)).toBeVisible();
  await expect(
    strategies.getByText("Demo advice: sample data, not financial advice"),
  ).toBeVisible();
  // The filled-in page has no serious accessibility problems (e2e/accessibility.spec.ts
  // checks it empty).
  const axe = await new AxeBuilder({ page })
    // The side chat is the chat page itself, checked on its own (/chat).
    .exclude('iframe[title="Chat with Jane"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );

  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Message Jane" }).fill("what's in my 401k");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/Your Demo 401\(k\) has \$84,250\.40 in 5 holdings/)).toBeVisible();

  // Step 129: the investor profile, answered in the chat a tap at a time.
  await page.getByRole("textbox", { name: "Message Jane" }).fill("what's my risk profile");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("1 of 4: How old are you?")).toBeVisible();
  await page.getByRole("button", { name: "40s" }).click();
  await expect(page.getByText("2 of 4: When will you need most of this money?")).toBeVisible();
  await page.getByRole("button", { name: "In 20 years or more" }).click();
  await page.getByRole("button", { name: "I'd worry, but wait it out" }).click();
  await page.getByRole("button", { name: "Retirement" }).click();
  await expect(page.getByText(/Thanks\. Your profile: Medium/)).toBeVisible();

  // And changed on its page.
  await page.goto("/investments/profile");
  await expect(page.getByText("Medium", { exact: true })).toBeVisible();
  await page.getByLabel("I'd put more in").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByText("Very high", { exact: true })).toBeVisible();

  // Step 130: what investing costs, with lower-cost equivalents labelled as demo advice.
  await page.goto("/investments/fees");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What investing costs you");
  await expect(page.getByText("Advisory fees, last 12 months")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lower-cost equivalents" })).toBeVisible();
  await expect(page.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  await expect(page.getByText("How this is worked out: a range, not a promise")).toBeVisible();

  // Step 131: the review against the (now aggressive) profile, labelled.
  await page.goto("/investments/review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Portfolio review");
  await expect(page.getByText("Very high", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to change" })).toBeVisible();
  await expect(page.getByText(/into international stocks/)).toBeVisible();
  await expect(page.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  // Step 132: retirement as a range in today's dollars, with the missed match, labelled.
  await page.goto("/investments/retirement");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Retirement");
  await expect(page.getByText(/miss about \$816\.00 a year/)).toBeVisible();
  await expect(
    page.getByText("Raise your 401(k) contribution from 4% to 6% of your pay."),
  ).toBeVisible();
  await expect(page.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  await expect(page.getByText("How this is worked out: a range, not a promise")).toBeVisible();

  // Step 133: the orders, simulated and said so, placed with one tap.
  await page.goto("/investments/rebalance");
  await expect(page.getByText(/^Simulated brokerage: these orders are pretend/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "The orders" })).toBeVisible();
  await page.getByRole("button", { name: "Move to the recommended mix (simulated)" }).click();
  await expect(page.getByRole("status")).toContainText("filled in the simulation");
  await expect(page.getByText("Your mix is on target: nothing to trade.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Orders and confirmations" })).toBeVisible();
  await page.goto("/investments");
  await expect(page.getByText(/^Simulated brokerage: these orders are pretend/)).toBeVisible();

  // Step 134: automatic investing, set up once, through the simulated brokerage.
  await page.goto("/investments/auto");
  await expect(page.getByText(/^Simulated brokerage: these orders are pretend/)).toBeVisible();
  await expect(page.getByLabel("Amount each payday in dollars")).toHaveValue("100.00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByText("On: $100.00 every payday into Demo Brokerage.")).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused: $100.00 every payday into Demo Brokerage.")).toBeVisible();

  // Step 135: which account first, where to hold what, gains not yet taxed.
  await page.goto("/investments/accounts");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Which account first");
  await expect(page.getByRole("heading", { name: "Fill them in this order" })).toBeVisible();
  await expect(page.getByText(/Your 401\(k\), up to the full match/)).toBeVisible();
  // After the rebalance above, no bond fund sits in the taxable account.
  await expect(page.getByText(/Keystone Total Bond Index Fund \(Demo Brokerage\)/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gains and losses not yet taxed" })).toBeVisible();

  // Step 136: plain explainers, one tap from the investments page, marked for review.
  await page.goto("/investments");
  await page.getByText("Learn the basics", { exact: true }).click();
  await page.getByRole("link", { name: "index funds" }).click();
  await expect(page).toHaveURL("/learn/index-funds");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Index funds");
  await expect(page.getByText(/waiting for review by counsel/)).toBeVisible();
  await page.getByRole("link", { name: "← Learn" }).click();
  await expect(page.getByRole("link", { name: "Standard deduction" })).toBeVisible();

  // Step 137: what Jane does by herself, and how it's going.
  await page.goto("/investments");
  await page.getByText("What Jane does by herself", { exact: true }).first().click();
  await expect(page.getByRole("region", { name: "What Jane does by herself" })).toBeVisible();
  await page.goto("/chat");
  await page.getByRole("textbox", { name: "Message Jane" }).fill("how are my investments doing");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/^Your investments start \w+ at \$/)).toBeVisible();
});

// Phase AE (steps 156 on), with a person of its own: the journey above spends the demo
// brokerage's cash.
test("prices, goals, college, HSA, company stock, crypto and cash, each with its taps", async ({
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

  // Step 156: how they've done, past results only, prices from the demo feed.
  await page.goto("/investments");
  const done = await pickItem(page, "Investing", "How it's done", "Returns");
  await expect(page.getByRole("heading", { name: "How they've done" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Last 12 months" })).toBeVisible();
  await done.getByText("More", { exact: true }).click();
  await expect(page.getByText(/Prices come from the demo price feed \(made up\)/)).toBeVisible();

  // Step 157: each goal invested for its timeline, with the glide path shown.
  await page.goto("/investments/goals");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Invested for each goal");
  await expect(page.getByRole("heading", { name: "The glide path" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "0 to 3" })).toBeVisible();

  // Step 158: college savings, set up as a goal.
  await page.goto("/investments/college");
  await page.getByLabel("Child's first name").fill("Sam");
  await page.getByLabel("Age now").fill("5");
  await page.getByRole("button", { name: "Start saving for college" }).click();
  await expect(page.getByRole("status")).toContainText("Saved as a goal");
  await expect(page.getByRole("heading", { name: "Sam, 5" })).toBeVisible();
  await expect(
    page.getByText(/four years\. Put aside about \$[\d,.]+ to \$[\d,.]+ a month/),
  ).toBeVisible();

  // Step 159: a demo HSA, its extra cash invested with a tap, and the receipts vault.
  await page.goto("/investments/hsa");
  await page.getByRole("button", { name: "Link a demo HSA" }).click();
  await expect(page.getByRole("heading", { name: /^Demo HSA: \$/ })).toBeVisible();
  await page.getByRole("button", { name: /^Invest \$/ }).click();
  await expect(page.getByText(/^Simulated brokerage: these orders are pretend/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Receipts vault" })).toBeVisible();
  await expect(page.getByText("BRIGHT SMILES DENTAL", { exact: false })).toBeVisible();

  // Step 160: a demo stock plan, the plan to sell down with its tax, the first part sold.
  await page.goto("/investments/company-stock");
  await page.getByRole("button", { name: "Link a demo stock plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Demo stock plan linked.");
  await expect(page.getByRole("heading", { name: /^Sell down in \d parts$/ })).toBeVisible();
  await expect(page.getByText(/Estimated tax on the gains: about \$[\d,.]+/)).toBeVisible();
  await page.getByRole("button", { name: "Sell the first part (simulated)" }).click();
  await expect(page.getByRole("status")).toContainText("Sold the first part");
  await expect(page.getByRole("button", { name: "Sell the first part (simulated)" })).toHaveCount(
    0,
  );

  // Step 161: crypto, read-only, with its source and time, counted in net worth.
  await page.goto("/investments/crypto");
  await page.getByRole("button", { name: "Connect a demo exchange" }).click();
  await expect(page.getByRole("status")).toHaveText("Connected, read-only.");
  await expect(page.getByRole("heading", { name: /^Demo Exchange: \$/ })).toBeVisible();
  await expect(
    page.getByText(/From Demo Exchange \(demo, sample data\), read-only, as of /),
  ).toBeVisible();
  await expect(page.getByText(/a common rule of thumb keeps a speculative holding/)).toBeVisible();
  await expect(page.getByRole("button", { name: /sell|buy|trade/i })).toHaveCount(0);
  await page.goto("/net-worth");
  await expect(page.getByText(/in crypto, as your exchange or wallet last/)).toBeVisible();

  // Step 162: cash with a job each, the emergency fund in reach, a move with a tap.
  await page.goto("/investments/cash");
  await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
  await expect(page.getByText(/^Emergency fund: High-yield savings/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Treasury ladder.*Never/ })).toBeVisible();
  await page.getByRole("button", { name: /in the money market fund$/ }).click();
  await expect(page.getByRole("status")).toContainText("It's moving through the stand-in");
});

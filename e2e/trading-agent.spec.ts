import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, treatAsDemoBank } from "./db";

// The 24-hour agent (founder, 2026-10-26): start a paper account, pick a market, how often and a
// strategy (each with its replay's result), and the agent catches up on the last day at once:
// its trades show with their time, price, fees and reason. Sample bars in tests
// (PAPER_SAMPLE_PRICES=1); simulated money and demo advice only. On a computer and at 375 px.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(150_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  await treatAsDemoBank(user.userId);
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

for (const size of [
  { name: "a computer", width: 1280, height: 900 },
  { name: "a phone", width: 375, height: 812 },
]) {
  test(`start the 24-hour agent and see a day of its trades after the catch-up, on ${size.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await signIn(page, baseURL);
    await page.goto("/investments");

    const paper = page.locator("#paper");
    await paper.getByRole("button", { name: "Start paper account" }).click();
    await expect(paper).toHaveAttribute("data-paper-account", "running", { timeout: 60_000 });

    const agent = page.getByRole("region", { name: "24-hour agent" });
    await expect(agent).toBeVisible();
    await agent.getByLabel("Bitcoin and ether, around the clock").check();
    await agent.getByLabel("15 minutes").check();
    await agent
      .getByLabel("Strategy for the 24-hour agent")
      .selectOption("catalog:vol_target@BTC/USD");
    await expect(agent.getByText(/^In the replay: .* a year \(just holding .*\)/)).toBeVisible();
    await expect(agent.getByText(/usually loses to just holding/)).toBeVisible();
    await agent.getByRole("button", { name: "Start the 24-hour agent" }).click();

    // It caught up on the last day: trades with their time, price, fees and reason.
    await expect(agent.getByText(/Caught up to the bar at .* ET\./)).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      agent.getByText(/every 15 minutes, bitcoin and ether, around the clock\./),
    ).toBeVisible();
    await expect(agent.getByText("Sample prices: development only, not real.")).toBeVisible();
    const rows = agent
      .getByRole("table", { name: "The 24-hour agent's trades" })
      .locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText(/(Bought|Sold) [\d.]+ BTC \(\$[\d,]+\.\d\d\)/);
    await expect(rows.first()).toContainText(/ ET/);
    await expect(rows.first().locator("td").nth(3)).toHaveText(/^\$\d[\d,]*\.\d\d$/);
    await expect(rows.first().locator("td").nth(4)).toContainText(/Volatility targeting on BTC/);
    await expect(agent.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

    // Stop it: the picker is back.
    await agent.getByRole("button", { name: "Stop the agent" }).click();
    await expect(agent.getByRole("button", { name: "Start the 24-hour agent" })).toBeVisible();
  });
}

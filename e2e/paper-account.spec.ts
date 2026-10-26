import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, addPaperSignal, deleteUser, signedInUser, treatAsDemoBank } from "./db";

// The paper account (founder: "start a paper trading account that users can now run … and jane
// should be recommending trades when opportunities arise … a separate pop up"): started from the
// investments page with a balance, run by the chosen strategy; a trade from the rule comes up in
// its own pop-up, apart from the suggestion cards, where Paper trade it is instant with Revert,
// and Skip puts it away. Simulated money and demo advice only. On a computer and at 375 px.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

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
  return user.userId;
}

for (const size of [
  { name: "a computer", width: 1280, height: 900 },
  { name: "a phone", width: 375, height: 812 },
]) {
  test(`start a paper account, then paper trade, revert and skip from the trade pop-up, on ${size.name}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const id = await signIn(page, baseURL);
    await page.goto("/investments");

    // Start it with a balance of the person's own.
    const paper = page.locator("#paper");
    await expect(paper).toHaveAttribute("data-paper-account", "none");
    await expect(paper.getByText(/^Run .* on simulated money at real prices/)).toBeVisible();
    const balance = paper.getByLabel("Starting balance in dollars");
    await expect(balance).toHaveValue("10000");
    await balance.fill("25000");
    await paper.getByRole("button", { name: "Start paper account" }).click();
    // Starting reads a year and a half of closes for the strategy's funds: it can take a while.
    await expect(paper).toHaveAttribute("data-paper-account", "running", { timeout: 60_000 });
    await expect(paper.locator("[data-paper-value]")).toHaveText(/^\$2[45],\d{3}$/);
    await expect(paper.getByText(/^Runs .* just holding your mix:/)).toBeVisible();
    await paper.getByText(/^Trade log \(\d+\)$/).click();
    await expect(paper.locator("[data-paper-trades] li").first()).toContainText(/Bought \$/);
    await expect(paper.getByText(/Simulated money: nothing real is bought or sold/)).toBeVisible();
    await expect(paper.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

    // The rule fires: its trade comes up in its own pop-up, not among the suggestion cards.
    await addPaperSignal(id);
    await page.reload();
    const popup = page.getByRole("complementary", { name: "Trade alert" });
    await expect(popup).toBeVisible();
    await expect(popup.locator("[data-trade-headline]")).toHaveText("Sell $1,000 of VTI");
    await expect(popup.getByText("SELL VTI")).toBeVisible();
    await expect(popup.getByText("70% sure")).toBeVisible();
    await expect(popup.getByText(/VTI down to 30% of the account/)).toBeVisible();
    await expect(popup.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
    await expect(page.locator("[data-card-dock] [data-trade-popup]")).toHaveCount(0);
    await popup.getByRole("button", { name: "More details" }).click();
    await expect(popup.locator("[data-trade-more]")).toContainText("Simulated money only");

    // Paper trade it: done at once, with Revert; the trade is in the log.
    await popup.getByRole("button", { name: "Paper trade it" }).click();
    await expect(popup.locator("[data-trade-done]")).toHaveText(
      "[✓ PAPER TRADED] Sell $1,000 of VTI",
    );
    await expect(popup.getByRole("button", { name: "Revert" })).toBeVisible();
    await expect(async () => {
      await page.reload();
      await page
        .locator("#paper")
        .getByText(/^Trade log/)
        .click();
      await expect(
        page.locator("[data-paper-trades] li").filter({ hasText: "Sold $1,000 of VTI" }),
      ).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(popup).toHaveCount(0);
  });
}

test("Revert takes a paper trade back, and Skip puts a trade away for good", async ({
  page,
  baseURL,
}) => {
  const id = await signIn(page, baseURL);
  await page.goto("/investments");
  await page.locator("#paper").getByRole("button", { name: "Start paper account" }).click();
  await expect(page.locator("#paper")).toHaveAttribute("data-paper-account", "running", {
    timeout: 60_000,
  });
  await addPaperSignal(id);
  await page.reload();
  const popup = page.getByRole("complementary", { name: "Trade alert" });
  // The trade log open: the page redraws it after each trade, in place.
  await page
    .locator("#paper")
    .getByText(/^Trade log/)
    .click();
  const log = page.locator("[data-paper-trades] li");
  await popup.getByRole("button", { name: "Paper trade it" }).click();
  await expect(popup.locator("[data-trade-done]")).toBeVisible();
  await popup.getByRole("button", { name: "Revert" }).click();
  // Back at once, waiting to be decided again; the log shows it taken back.
  await expect(popup.getByText("Reverted.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Paper trade it" })).toBeVisible();
  await expect(log.filter({ hasText: "Sold $1,000 of VTI" })).toContainText("[REVERTED]", {
    timeout: 30_000,
  });
  await page.reload();
  // Still waiting after the reload; Skip puts it away, for good.
  await expect(popup.locator("[data-trade-headline]")).toHaveText("Sell $1,000 of VTI");
  await popup.getByRole("button", { name: "Skip" }).click();
  await expect(popup).toHaveCount(0);
  await expect(async () => {
    await page.reload();
    await expect(page.locator("#paper")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.getByRole("complementary", { name: "Trade alert" })).toHaveCount(0);
  }).toPass({ timeout: 30_000 });
});

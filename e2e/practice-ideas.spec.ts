import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, addPracticeIdea, deleteUser, signedInUser } from "./db";
import { landInChat } from "./chat-page";

// Jane's practice ideas on the practice portfolio page (Phase AW, Stage A): each idea with how
// sure Jane is and Yes or No, the strategy followed today, and what the person's answers
// changed. Practice money and demo advice only.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("an idea shows how sure Jane is, and a No changes what she brings", async ({
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

  // A sample person's practice portfolio starts by itself during the first scan, a few weeks
  // back, with those days replayed: no start button to find.
  // The portfolio starts before the first suggestions; its days are replayed beside the scan's
  // other work, so the trades come a little after.
  await expect(async () => {
    await page.goto("/investments/practice");
    await expect(page.getByText(/^Bought /).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Start with practice money" })).toHaveCount(0);
  const ideas = page.getByRole("region", { name: "Jane's ideas" });
  await expect(ideas.getByText("Strategy today:")).toBeVisible();
  await expect(ideas.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  await addPracticeIdea(user.userId);
  await page.reload();
  const idea = ideas
    .getByRole("listitem")
    .filter({ hasText: "Check your mix: stocks are drifting toward the band" });
  await expect(idea).toBeVisible();
  await expect(idea.getByText(/70% sure: a fixed measure of the mix/)).toBeVisible();
  await idea.getByRole("button", { name: "No", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(/OK, put away/);
  await expect(idea).toHaveCount(0);
  await expect(ideas.getByText(/You said no once, but it's a safety check/)).toBeVisible();

  // The investments page: more strategies, each a card with its curve, its numbers against the
  // mix and the levels it fits.
  await page.goto("/investments");
  await pickItem(page, "Investing", "Strategies", "More strategies");
  const menu = page.getByRole("region", { name: "More strategies" });
  await expect(
    menu.locator('li[data-strategy]:not([data-strategy^="crypto_"]):not([data-family="intraday"])'),
  ).toHaveCount(7);
  const value = menu.getByRole("listitem").filter({ hasText: "Value tilt" });
  await expect(value.getByRole("img", { name: /^Value tilt: \$100 became \$\d+/ })).toBeVisible();
  await expect(value.getByText(/a year \(your mix [\d.]+%\), worst drop/)).toBeVisible();
  await expect(value.getByText(/^Fits: /)).toBeVisible();
  // Crypto, at Very high only, with its warning and each rule against holding.
  await expect(menu.getByRole("heading", { name: "Crypto (Very high only)" })).toBeVisible();
  await expect(
    menu.getByText(/Crypto has lost 70% to 80% of its value more than once/),
  ).toBeVisible();
  await expect(
    menu
      .getByRole("listitem")
      .filter({ hasText: "Crypto momentum" })
      .getByText(/Since 2022: .* \(holding: /),
  ).toBeVisible();
  // Day trading, at Very high only: the warning first, each rule against holding.
  await expect(menu.getByRole("heading", { name: "Day trading (Very high only)" })).toBeVisible();
  await expect(menu.getByText(/Most people who day trade lose money/)).toBeVisible();
  const vwap = menu.getByRole("listitem").filter({ hasText: "VWAP reversion" });
  await expect(
    vwap.getByRole("img", { name: /^VWAP reversion: \$100 became \$\d+ since 2024/ }),
  ).toBeVisible();
  await expect(vwap.getByText(/Since 2024: .* trades, .* \(holding: /)).toBeVisible();
  // Choose it for the practice portfolio, then go back to Jane's pick.
  await value.getByRole("button", { name: "Use in practice" }).click();
  await expect(value.getByText("Your practice portfolio uses this")).toBeVisible();
  await expect(menu.getByText(/Your practice portfolio follows Value tilt\./)).toBeVisible();
  await expect(
    menu
      .getByRole("listitem")
      .filter({ hasText: "Sector rotation" })
      .getByText(/Not in the practice portfolio yet/),
  ).toBeVisible();
  await value.getByRole("button", { name: "Back to Jane's pick" }).click();
  await expect(value.getByRole("button", { name: "Use in practice" })).toBeVisible();
  // The news themes, each with its past record; only the ones that held up are offered.
  await pickItem(page, "Investing", "News alerts", "News themes");
  const themes = page.getByRole("region", { name: "News themes" });
  await expect(themes.getByText(/^Defense when a war breaks out: ITA/)).toBeVisible();
  await expect(themes.getByText("tested, not offered").first()).toBeVisible();
  await expect(themes.getByText(/^USO instead: beat the market in \d+ of 9/)).toBeVisible();
  // It sums up the practice ideas and links back.
  await pickItem(page, "Investing", "Practice portfolio", "Your practice portfolio");
  const summary = page.getByRole("region", { name: "Jane's practice ideas" });
  await expect(summary.getByText(/strategy today:/)).toBeVisible();
  await expect(summary.getByText(/still brought \(a safety check\)/)).toBeVisible();
  await expect(
    summary.getByRole("link", {
      name: /^(Your practice portfolio|Answer (it|them) on your practice portfolio) →$/,
    }),
  ).toBeVisible();

  // The crypto sleeve, at Very high only: below it each card says so; at it, one can be run
  // and turned off again.
  await pickItem(page, "Investing", "Strategies", "More strategies");
  const trend = menu.getByRole("listitem").filter({ hasText: "Crypto trend" });
  await expect(trend.getByText("In the practice portfolio at Very high only.")).toBeVisible();
  await page.goto("/investments/practice/settings");
  await page.getByLabel("Risk level").selectOption("5");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved. Jane uses it from the next run.");
  await page.goto("/investments?focus=strategies:menu");
  await trend.getByRole("button", { name: "Use in practice" }).click();
  await expect(trend.getByText("Your practice portfolio runs this sleeve")).toBeVisible();
  await trend.getByRole("button", { name: "Turn the sleeve off" }).click();
  await expect(trend.getByRole("button", { name: "Use in practice" })).toBeVisible();
  // Day trading the same way, under its warning.
  const orb = menu.getByRole("listitem").filter({ hasText: "Opening-range break" });
  await orb.getByRole("button", { name: "Use in practice" }).click();
  await expect(orb.getByText("Your practice portfolio day trades with this")).toBeVisible();
  await expect(menu.getByText(/Most people who day trade lose money/)).toBeVisible();
  await orb.getByRole("button", { name: "Stop day trading" }).click();
  await expect(orb.getByRole("button", { name: "Use in practice" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addPracticeIdea, deleteUser, signedInUser } from "./db";

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
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

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

  // The investments page sums it up and links back.
  await page.goto("/investments");
  // More strategies, each a card with its curve, its numbers against the mix and the levels it fits.
  const menu = page.getByRole("region", { name: "More strategies" });
  await expect(menu.getByRole("listitem")).toHaveCount(7);
  const value = menu.getByRole("listitem").filter({ hasText: "Value tilt" });
  await expect(value.getByRole("img", { name: /^Value tilt: \$100 became \$\d+/ })).toBeVisible();
  await expect(value.getByText(/a year \(your mix [\d.]+%\), worst drop/)).toBeVisible();
  await expect(value.getByText(/^Fits: /)).toBeVisible();
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
  const themes = page.getByRole("region", { name: "News themes" });
  await expect(themes.getByText(/^Defense when a war breaks out: ITA/)).toBeVisible();
  await expect(themes.getByText("tested, not offered").first()).toBeVisible();
  await expect(themes.getByText(/^USO instead: beat the market in \d+ of 9/)).toBeVisible();
  const summary = page.getByRole("region", { name: "Jane's practice ideas" });
  await expect(summary.getByText(/strategy today:/)).toBeVisible();
  await expect(summary.getByText(/still brought \(a safety check\)/)).toBeVisible();
  await expect(
    summary.getByRole("link", {
      name: /^(Your practice portfolio|Answer (it|them) on your practice portfolio) →$/,
    }),
  ).toBeVisible();
});

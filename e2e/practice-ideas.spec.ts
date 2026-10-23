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
  await expect(async () => {
    await page.goto("/investments/practice");
    await expect(page.getByRole("heading", { name: "Everything Jane did" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Start with practice money" })).toHaveCount(0);
  await expect(page.getByText(/^Bought /).first()).toBeVisible();
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
  const summary = page.getByRole("region", { name: "Jane's practice ideas" });
  await expect(summary.getByText(/strategy today:/)).toBeVisible();
  await expect(summary.getByText(/still brought \(a safety check\)/)).toBeVisible();
  await expect(
    summary.getByRole("link", {
      name: /^(Your practice portfolio|Answer (it|them) on your practice portfolio) →$/,
    }),
  ).toBeVisible();
});

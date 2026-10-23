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

  await page.goto("/investments/practice");
  await page.getByRole("button", { name: "Start with practice money" }).click();
  const ideas = page.getByRole("region", { name: "Jane's ideas" });
  await expect(ideas.getByText("Strategy today:")).toBeVisible();
  await expect(ideas.getByText(/Nothing to decide right now/)).toBeVisible();
  await expect(ideas.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  await addPracticeIdea(user.userId);
  await page.reload();
  await expect(
    ideas.getByText("Check your mix: stocks are drifting toward the band"),
  ).toBeVisible();
  await expect(ideas.getByText(/70% sure: a fixed measure of the mix/)).toBeVisible();
  await ideas.getByRole("button", { name: "No", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(/OK, put away/);
  await expect(ideas.getByText(/Nothing to decide right now/)).toBeVisible();
  await expect(ideas.getByText(/You said no once, but it's a safety check/)).toBeVisible();

  // The investments page sums it up and links back.
  await page.goto("/investments");
  const summary = page.getByRole("region", { name: "Jane's practice ideas" });
  await expect(summary.getByText(/strategy today:/)).toBeVisible();
  await expect(summary.getByText(/Nothing to decide right now/)).toBeVisible();
  await expect(summary.getByText(/still brought \(a safety check\)/)).toBeVisible();
  await expect(summary.getByRole("link", { name: "Your practice portfolio →" })).toBeVisible();
});

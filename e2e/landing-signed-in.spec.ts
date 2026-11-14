import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// Beta walk 11-12 (debugger): a signed-in student who opened the site's address saw only "Get
// started" and "Sign in", as if signed out, and nothing to take them into Jane.
test("a signed-in student on the landing page is offered the way in", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "See how much money you're losing" }),
  ).toBeVisible();
  await expect(page.getByText("You're signed in.")).toHaveCount(0);

  await signInWith(context, user.sessionToken, baseURL);
  await page.reload();
  await page.getByRole("link", { name: "Open Jane" }).click();
  // No bank yet, so Home sends them on to add one.
  await expect(page).toHaveURL(/\/(home|connect)$/);
});

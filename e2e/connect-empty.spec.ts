import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// Beta walk 11-12 (debugger: "empty account, full app"): before anything was linked, a new
// student saw every area tab and the chat around "Add your accounts", each leading to an empty
// page. Until there's an account, /connect is the one thing to do.
test("a new student's Connect page has nothing around it to wander into", async ({
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
  await expect(page.getByRole("heading", { level: 1, name: "Add your accounts" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Chat/ })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: /chat/i })).toHaveCount(0);
  // The way out stays: the profile menu, to sign out or open Settings.
  await expect(page.locator("[data-app-top-bar]")).toBeVisible();
});

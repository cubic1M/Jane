import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("an admin without a two-factor code is sent to set one up", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin", { mfa: false });
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/admin/queue");

  await expect(page).toHaveURL(/\/mfa\?next=%2Fadmin%2Fqueue$/);
  await expect(page.getByRole("heading", { name: "Two-factor check" })).toBeVisible();
  await expect(page.getByText("Add this key to an authenticator app")).toBeVisible();

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "didn't match" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, userExists } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId && (await userExists(userId))) await deleteUser(userId);
});

test("delete all my data needs DELETE typed, then removes the account", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("admin");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/import");
  await page.getByLabel("Name").fill("Test Card");
  await page.getByLabel("Type").selectOption({ label: "Credit card" });
  await page.getByRole("button", { name: "Add account" }).click();
  // The page re-renders after adding; the newest copy of the list is the visible one.
  await expect(page.getByText("Test Card").last()).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Type DELETE to confirm").fill("delete");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Type DELETE" })).toBeVisible();
  expect(await userExists(userId)).toBe(true);

  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete all my data" }).click();
  await expect(page.getByRole("heading", { name: "Your data is deleted" })).toBeVisible();
  expect(await userExists(userId)).toBe(false);
});

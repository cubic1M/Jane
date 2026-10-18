import { expect, test } from "@playwright/test";
import {
  E2E_DATABASE_URL,
  addSession,
  deleteUser,
  sessionExists,
  signedInUser,
  userExists,
} from "./db";

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
  // Exact text: the account dropdown's "Test Card (Credit card)" option is hidden.
  await expect(page.getByText("Test Card", { exact: true })).toBeVisible();

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

// Spec step 73: where you're signed in, and signing another device out.
test("lists this device and signs another one out at once", async ({
  browser,
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  const phone = await addSession(
    userId,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  );
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/settings#sessions");
  const section = page.locator("#sessions");
  await expect(section.getByText("This device")).toBeVisible();
  await expect(section.getByText("iPhone · Safari")).toBeVisible();
  await expect(section.getByText(/hours ago/)).toBeVisible();
  // Only row ids reach the page, never a session token.
  const html = await page.content();
  expect(html).not.toContain(phone.sessionToken);
  expect(html).not.toContain(user.sessionToken);

  await section.getByRole("button", { name: /Sign out iPhone · Safari/ }).click();
  await expect(section.getByRole("status")).toHaveText("Signed out of that device.");
  await expect(section.getByText("iPhone · Safari")).toBeHidden();
  expect(await sessionExists(phone.id)).toBe(false);

  // The phone's cookie stops working on its next request.
  const phoneContext = await browser.newContext();
  await phoneContext.addCookies([
    { name: "authjs.session-token", value: phone.sessionToken, url: baseURL ?? "" },
  ]);
  const phonePage = await phoneContext.newPage();
  await phonePage.goto("/settings");
  await expect(phonePage).toHaveURL(/\/login/);
  await phoneContext.close();

  // This device is still signed in.
  await page.reload();
  await expect(page.locator("#sessions").getByText("This device")).toBeVisible();
});

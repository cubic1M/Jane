import { expect, test } from "@playwright/test";

test("sign-up page offers a magic link and links to sign in", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a sign-up link" })).toBeVisible();

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("login page explains an expired magic link", async ({ page }) => {
  await page.goto("/login?error=Verification");

  // Next.js adds an empty route announcer with role="alert"; look for ours by its text.
  await expect(
    page.getByRole("alert").filter({ hasText: "expired or was already used" }),
  ).toBeVisible();
});

for (const path of ["/home", "/connect", "/import", "/scanning", "/report", "/actions"]) {
  test(`signed-out visitors are sent from ${path} to /login`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL("/login");
  });
}

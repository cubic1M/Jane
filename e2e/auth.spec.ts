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

  await expect(page.getByRole("alert")).toContainText("expired or was already used");
});

test("signed-out visitors are sent from /import to /login", async ({ page }) => {
  await page.goto("/import");

  await expect(page).toHaveURL("/login");
});

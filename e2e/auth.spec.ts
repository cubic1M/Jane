import { expect, test } from "@playwright/test";
import { isHiddenPage } from "../src/config/hidden-pages";

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

// QA (2026-10-26): the page after asking for a sign-in link had two main landmarks.
// The sign-in form's redirect is a client-side move, and the page left behind stays mounted,
// hidden: so arrive the same way, from /login.
test("the check-your-email page has one main landmark", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(async () => {
    await page.evaluate(() =>
      (
        window as unknown as { next: { router: { push: (href: string) => void } } }
      ).next.router.push("/login/check-email"),
    );
    await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
});

// Pages the read-only beta hides (src/config/hidden-pages.ts) redirect first: not checked here.
for (const path of ["/home", "/connect", "/import", "/scanning", "/report", "/actions"].filter(
  (p) => !isHiddenPage(p),
)) {
  test(`signed-out visitors are sent from ${path} to /login`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL("/login");
  });
}

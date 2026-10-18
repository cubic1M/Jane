import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test("every page links to the legal pages", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "Security" })).toHaveAttribute("href", "/security");
});

for (const [path, heading] of [
  ["/privacy", "Privacy Policy"],
  ["/terms", "Terms of Service"],
  ["/security", "How we keep your data safe"],
]) {
  test(`${path} shows its content, marked as a draft`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Draft, pending legal review");
  });
}

test("sign-up asks for agreement to the Terms", async ({ page }) => {
  await page.goto("/signup");
  const consent = page.getByRole("checkbox", { name: /I agree to the Terms/ });
  await expect(consent).toBeVisible();
  expect(await consent.getAttribute("required")).not.toBeNull();
});

test.describe("existing users on an older Terms version", () => {
  test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
  test.setTimeout(120_000);
  let userId: string | undefined;
  test.afterEach(async () => {
    if (userId) await deleteUser(userId);
  });

  test("accept the new version once, then carry on", async ({ context, page, baseURL }) => {
    const user = await signedInUser("user", { termsVersion: "2020-01-01" });
    userId = user.userId;
    await context.addCookies([
      { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
    ]);

    await page.goto("/report");
    await expect(page).toHaveURL("/terms/accept");
    await expect(page.getByRole("heading", { name: "We've updated our Terms" })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL("/connect");

    await page.goto("/report");
    await expect(page).toHaveURL("/report");
  });
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

test("sign-up needs a valid invite code", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText("private beta")).toBeVisible();

  await page.getByLabel("Invite code").fill("ABCD-EFGH-JKMN");
  await page.getByLabel("Email").fill(`invite-${crypto.randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Email me a sign-up link" }).click();

  await expect(page).toHaveURL(/\/signup\?error=InvalidInvite/);
  await expect(page.getByRole("alert").filter({ hasText: "isn't valid" })).toBeVisible();
});

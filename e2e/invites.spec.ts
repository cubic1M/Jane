import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

test("sign-up needs a valid invite code", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText("private beta")).toBeVisible();

  await page.getByLabel("Invite code").fill("ABCD-EFGH-JKMN");
  await page.getByLabel("Email").fill(`invite-${crypto.randomUUID()}@example.test`);
  await page.getByRole("checkbox", { name: /I agree to the Terms/ }).check();
  await page.getByRole("button", { name: "Email me a sign-up link" }).click();

  await expect(page).toHaveURL(/\/signup\?error=InvalidInvite/);
  await expect(page.getByRole("alert").filter({ hasText: "isn't valid" })).toBeVisible();
});

// The closed beta: an invite link fills in the code; without one, who to ask and the
// waitlist, which keeps the email and sends nothing.
test("an invite link fills in the code, and without one there's a waitlist", async ({ page }) => {
  await page.goto("/signup?invite=abcd-efgh-jkmn");
  await expect(page.getByLabel("Invite code")).toHaveValue("ABCD-EFGH-JKMN");
  await expect(page.getByRole("button", { name: "Join the waitlist" })).toHaveCount(0);

  await page.goto("/signup");
  await expect(page.getByRole("note")).toContainText(
    "Jane is in private beta. Ask a founder for an invite.",
  );
  await page.getByLabel("Join the waitlist").fill(`wait-${crypto.randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(page).toHaveURL(/\/signup\?waitlist=joined/);
  await expect(page.getByRole("status")).toContainText("You're on the waitlist");
});

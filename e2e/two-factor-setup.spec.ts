import { expect, test } from "@playwright/test";
import { totp } from "../src/lib/totp";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// Beta walk 11-12: turning on two-factor in Settings went straight back to Settings, which said
// "10 backup codes left" for codes the person had never been shown.
test("turning on two-factor shows the backup codes once", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/settings/two-factor");
  await expect(page.getByRole("heading", { name: "Turn on two-factor" })).toBeVisible({
    timeout: 60_000,
  });
  const uri = await page
    .getByRole("link", { name: /Tap to add it to your authenticator app/ })
    .getAttribute("href");
  const url = new URL(uri ?? "");
  // The authenticator app lists it under the name the person knows.
  expect(url.searchParams.get("issuer")).toBe("Jane");

  await page
    .getByLabel("6-digit code")
    .fill(totp(url.searchParams.get("secret") ?? "", new Date()));
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Save your backup codes" })).toBeVisible();
  await expect(page.locator("li.font-mono, ul.font-mono li")).toHaveCount(10);
  await page.getByRole("link", { name: "I've saved them, continue" }).click();
  await expect(page.getByText("10 backup codes left")).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Sign-in, analytics and phone alerts before their keys are set (as on the live site now;
// docs/setup/): no Google button on /login or /signup, no "turn on alerts" in Settings, and
// everything else still works. With the keys, the unit tests cover them
// (src/components/auth-form.test.tsx, src/lib/push.integration.test.ts).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("without Google's or the push keys: no Google button, no alerts toggle", async ({
  context,
  page,
  baseURL,
}) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /^Email me/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  }

  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Get urgent alerts on this device instead of by email.")).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Turn on", exact: true })).toHaveCount(0);
});

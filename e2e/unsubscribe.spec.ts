import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_AUTH_SECRET, E2E_DATABASE_URL, deleteUser, digestEnabled, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

// Same format as src/lib/digest/unsubscribe.ts.
function token(userId: string) {
  const signature = createHmac("sha256", E2E_AUTH_SECRET).update(`unsubscribe:${userId}`).digest();
  return `${Buffer.from(userId).toString("base64url")}.${signature.toString("base64url")}`;
}

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("unsubscribe works without signing in", async ({ page }) => {
  userId = (await signedInUser("user")).userId;

  // No session cookie: this browser isn't signed in.
  await page.goto(`/unsubscribe?token=${token(userId)}`);
  expect(await digestEnabled(userId)).toBe(true); // opening the link alone changes nothing
  await page.getByRole("button", { name: "Unsubscribe" }).click();

  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
  expect(await digestEnabled(userId)).toBe(false);
});

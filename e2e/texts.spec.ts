import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser, userExists } from "./db";

// Texts (spec step 78), with the simulated provider the dev server uses without Sendblue
// keys: add a number with consent, enter the code, then answer from the simulated phone.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

// The dev server's test-only key (playwright.config.ts), to set a known code: the real one
// is only in the dev server's log.
const KEY = Buffer.alloc(32, 7);
async function setCode(userId: string, code: string) {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const hash = createHmac("sha256", KEY).update(`text-code:${userId}:${code}`).digest("hex");
    await client.query(`UPDATE text_settings SET code_hash = $1 WHERE user_id = $2`, [
      hash,
      userId,
    ]);
  } finally {
    await client.end();
  }
}

let userId: string | undefined;
test.afterEach(async () => {
  if (userId && (await userExists(userId))) await deleteUser(userId);
});

test("add a number with consent, verify it, and answer from the simulated phone", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  // A made-up number, different each run so it's never already on another account.
  const last4 = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
  const area = 200 + Math.floor(Math.random() * 800);

  await page.goto("/settings#texts");
  await page.getByLabel("Your mobile number (US)").fill(`(${area}) 555-${last4}`);
  await page.getByLabel(/Jane may text you about your money/).check();
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByText(`We texted a code to (•••) •••-${last4}`)).toBeVisible();

  await setCode(userId, "424242");
  await page.getByLabel(/The 6-digit code we texted/).fill("424242");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("Your number is verified. Texts are on.")).toBeVisible();
  await expect(page.getByLabel("Texts from Jane")).toBeChecked();

  await page.getByRole("link", { name: "Open the simulated phone to try replying" }).click();
  await expect(page.getByRole("heading", { name: "Simulated phone" })).toBeVisible();
  await page.getByLabel("Reply as your phone").fill("HELP");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent (read as: help).")).toBeVisible();
  await expect(page.getByText(/Jane texts you about your money/)).toBeVisible();
});

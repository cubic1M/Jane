import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

// The e2e server runs without a Claude key, so Jane gives her "not available" reply; the
// answers themselves are covered by unit tests with a mocked Claude.
test("asking saves a conversation the person can delete", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/ask");
  await expect(page.getByText("not financial, tax or legal advice")).toBeVisible();
  await page.getByLabel("Your question").fill("How much did I spend on food?");
  await page.getByRole("button", { name: "Ask" }).click();

  const conversation = page.getByRole("list", { name: "Conversation" });
  await expect(conversation).toContainText("How much did I spend on food?");
  await expect(conversation).toContainText("isn't available right now");
  await expect(page).toHaveURL(/\/ask\?c=/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.reload();
  await expect(page.getByRole("link", { name: "How much did I spend on food?" })).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/ask");
  await expect(page.getByRole("link", { name: "How much did I spend on food?" })).toHaveCount(0);
});

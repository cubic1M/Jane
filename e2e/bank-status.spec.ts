import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addBankNeedingSignIn, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// A bank that paused sharing until the person signs in again (Plaid's ITEM_LOGIN_REQUIRED):
// Home says so calmly, once, with how old that bank's data is and a button that opens Plaid
// Link in update mode; /connect says the same beside the bank.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a bank that needs a sign-in is said calmly, with how old its data is", async ({
  context,
  page,
  baseURL,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await addBankNeedingSignIn(userId, "Lapsed Bank");

  await page.goto("/home");
  const notice = page.locator('[data-bank-notice="sign_in"]');
  await expect(notice).toHaveCount(1);
  await expect(notice).toContainText("Your bank needs you to sign in again");
  await expect(notice).toContainText("Lapsed Bank paused sharing until you sign in");
  await expect(notice).toContainText("last updated 3 days ago");
  await expect(notice.getByRole("button", { name: "Sign in again" })).toBeVisible();
  // Not said a second time by the books notice.
  await expect(page.getByText("Lapsed Bank needs you to sign in again")).toHaveCount(0);

  await page.goto("/connect");
  const bank = page.getByRole("listitem").filter({ hasText: "Lapsed Bank" });
  await expect(bank).toContainText("Updated 3 days ago");
  await expect(bank.locator('[data-bank-notice="sign_in"]')).toContainText(
    "Your bank needs you to sign in again",
  );
  await expect(bank.getByRole("button", { name: "Sign in again" })).toBeVisible();
});

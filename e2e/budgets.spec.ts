import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a person sets a budget and sees its progress", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/budgets");
  await page.getByLabel("Category").selectOption("Food and drink");
  await page.getByLabel("Monthly budget ($)").fill("400");
  await page.getByRole("button", { name: "Set budget" }).click();

  await expect(page.getByRole("heading", { name: "Food and drink" })).toBeVisible();
  await expect(page.getByText("$0.00 of $400.00, $400.00 left")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Food and drink budget used" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("heading", { name: "Food and drink" })).toHaveCount(0);
});

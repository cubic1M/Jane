import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { landInChat } from "./chat-page";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a demo bank fills the report with fake data, labelled as fake, and can be removed", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  // Spec step 82: the scan ends in Jane's chat (e2e/chat.spec.ts); the report is a tap away.
  await landInChat(page, 60_000);
  await page.goto("/report");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("We found");
  await expect(page.getByRole("link", { name: /Netflix went up/ })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("demo bank with fake data");

  // The best option for this person, picked and ready for one yes (spec steps 76–77).
  await page.getByRole("link", { name: /Verizon Wireless phone bill/ }).click();
  const best = page.getByRole("region", { name: "The best option for you" });
  await expect(best.getByText("Jane's pick")).toBeVisible();
  await expect(best.getByRole("radio", { name: /Pine Mobile Unlimited/ })).toBeChecked();
  await page.getByRole("button", { name: "Yes, switch to Pine Mobile Unlimited" }).click();
  await expect(page).toHaveURL("/actions");
  await expect(page.getByRole("link", { name: "Sign up for Pine Mobile Unlimited" })).toBeVisible();

  await page.goto("/loans");
  await expect(page.getByText("Demo Home Loan ····0004")).toBeVisible();

  await page.getByRole("note").getByRole("link", { name: "Remove it" }).click();
  await expect(page).toHaveURL(/\/settings#banks/);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: /Disconnect/ })
    .first()
    .click();
  await expect(page.getByText("No banks linked.")).toBeVisible();
  await page.goto("/home");
  await expect(page.getByRole("note")).toHaveCount(0);
});

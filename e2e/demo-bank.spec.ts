import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

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
  await expect(page).toHaveURL("/report", { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("We found");
  await expect(page.getByRole("link", { name: /Netflix went up/ })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("demo bank with fake data");

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

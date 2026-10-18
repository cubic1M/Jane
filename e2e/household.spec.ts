import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

const ids: string[] = [];
test.afterEach(async () => {
  for (const id of ids.splice(0)) await deleteUser(id);
});

test("a partner joins with the invite link, and leaving ends the sharing", async ({
  browser,
  baseURL,
}) => {
  const alex = await signedInUser("user");
  const blair = await signedInUser("user");
  ids.push(alex.userId, blair.userId);
  const as = async (sessionToken: string) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.addCookies([
      { name: "authjs.session-token", value: sessionToken, url: baseURL ?? "" },
    ]);
    return context.newPage();
  };

  const alexPage = await as(alex.sessionToken);
  await alexPage.goto("/household");
  await alexPage.getByLabel("Your partner's email").fill(`${blair.userId}@example.test`);
  await alexPage.getByRole("button", { name: "Invite" }).click();
  const link = await alexPage.getByLabel("Invite link").inputValue();
  expect(link).toContain("/household/join?token=");

  const blairPage = await as(blair.sessionToken);
  await blairPage.goto(new URL(link).pathname + new URL(link).search);
  await blairPage.getByRole("button", { name: "Join household" }).click();
  await expect(blairPage).toHaveURL("/household");
  await expect(blairPage.getByText(`You share with ${alex.userId}@example.test`)).toBeVisible();
  const overflow = await blairPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await blairPage.getByRole("button", { name: "Leave household" }).click();
  await expect(blairPage.getByRole("heading", { name: "Invite your partner" })).toBeVisible();
  await alexPage.reload();
  await expect(alexPage.getByText(/You share with/)).toHaveCount(0);
});

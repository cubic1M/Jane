import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// "Report a problem" (closed beta): from the profile menu on any signed-in page, the person's own
// words and the page go to the founders, who read them at /admin/reports.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

const users: string[] = [];
test.afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(id);
});

test("a person reports a problem from any page, and the founders read it", async ({
  browser,
  baseURL,
}) => {
  const person = await signedInUser("user");
  users.push(person.userId);
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: person.sessionToken, url: baseURL ?? "" },
  ]);
  const page = await context.newPage();
  await page.goto("/net-worth");
  await page.getByRole("button", { name: "Your account and settings" }).click();
  await page.getByRole("link", { name: "Report a problem" }).click();
  await expect(page).toHaveURL("/report-a-problem?from=%2Fnet-worth");
  await expect(page.getByText("Something wrong on /net-worth?")).toBeVisible();

  const words = `The line looks wrong ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("What went wrong?").fill(words);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("[data-report-sent]")).toContainText("Thanks.");
  await page.getByRole("link", { name: "Back to where you were" }).click();
  await expect(page).toHaveURL("/net-worth");
  await context.close();

  // The founders see the words, the page and who sent it.
  const admin = await signedInUser("admin");
  users.push(admin.userId);
  const adminContext = await browser.newContext();
  await adminContext.addCookies([
    { name: "authjs.session-token", value: admin.sessionToken, url: baseURL ?? "" },
  ]);
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/admin/reports");
  const report = adminPage.locator("[data-problem-report]").filter({ hasText: words });
  await expect(report).toBeVisible();
  await expect(report).toContainText("/net-worth");
  await adminContext.close();
});

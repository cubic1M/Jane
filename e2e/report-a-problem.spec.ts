import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// "Send feedback" (closed beta): from the profile menu on any signed-in page (two taps), the
// person's own words, the page and an optional screenshot go to the founders, who read them at
// /admin/reports.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

const users: string[] = [];
test.afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(id);
});

// The smallest PNG there is: one transparent pixel.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("a person sends feedback from any page, and the founders read it", async ({
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
  await page.getByRole("link", { name: "Send feedback" }).click();
  await expect(page).toHaveURL("/report-a-problem?from=%2Fnet-worth");
  // Named as the menu names it; the address still goes with the report (below).
  await expect(
    page.getByText("Something wrong, confusing or good on Plans & goals?"),
  ).toBeVisible();

  const words = `The line looks wrong ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("What's on your mind?").fill(words);
  await page
    .getByLabel("Screenshot (optional)")
    .setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PIXEL });
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
  // The screenshot opens for the founders only, as the picture that was sent.
  const shot = await adminPage.request.get(
    (await report.getByRole("link", { name: "Screenshot" }).getAttribute("href")) ?? "",
  );
  expect(shot.headers()["content-type"]).toBe("image/png");
  expect(Buffer.from(await shot.body()).equals(PIXEL)).toBe(true);
  await adminContext.close();
});

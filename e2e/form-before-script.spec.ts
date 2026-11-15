import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { signInWith } from "./session";

// Debugger 11-15: tapped before the page's script ran (a slow phone), /import's form went out as a
// plain form, and the address became /import?accountId=new&new.name=…&new.balance=…&files=…: an
// account's name and balance in the history and the server's request logs. It posts now.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

test("the upload form tapped before its script runs puts nothing in the address", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(context, user.sessionToken, baseURL);
  // No script ever arrives: the page is the plain HTML a slow phone shows first.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto("/import");
  await page.locator('input[name="new.name"]').fill("My checking at the credit union");
  await page.locator('input[name="new.balance"]').fill("4,017.77");
  await page.locator('input[type="file"]').setInputFiles({
    name: "checking.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n11/01/2026,COFFEE,-4.50\n"),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.waitForLoadState("domcontentloaded");
  expect(new URL(page.url()).search).toBe("");
});

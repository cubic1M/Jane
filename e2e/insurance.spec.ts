import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Insurance (spec step 102): a person says they rent, sees the missing renters cover, adds
// their policy and the gap goes.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a renter adds their renters policy and the gap goes", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/insurance");
  await expect(page.getByRole("heading", { name: "Insurance", level: 1 })).toBeVisible();
  await page.getByLabel("Your home").selectOption("rent");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("No renters insurance on file")).toBeVisible();

  await page.getByRole("link", { name: "I have this: add it" }).click();
  const add = page.locator("#add");
  await expect(add.getByLabel("What it insures")).toHaveValue("renters");
  await add.getByLabel("Insurance company").fill("Lemonade");
  await add.getByLabel("Price ($)").fill("12");
  await add.getByLabel("Paid").selectOption("monthly");
  await add.getByLabel("Your belongings ($)").fill("30000");
  await add.getByRole("button", { name: "Add it" }).click();

  await expect(page.getByText("Added to your insurance.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lemonade renters insurance" })).toBeVisible();
  await expect(page.getByText("Your belongings: $30,000.00")).toBeVisible();
  await expect(page.getByText("No renters insurance on file")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a demo-bank person sees the sample policy and gets like-for-like quotes (steps 102–103)", async ({
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
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  await page.goto("/insurance");
  await expect(page.getByRole("heading", { name: "GEICO car insurance" })).toBeVisible();
  // The demo bank has a mortgage and no home policy: a gap, with demo advice, labelled.
  await expect(page.getByText("No home insurance on file")).toBeVisible();
  await expect(page.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  await page.getByRole("link", { name: "Compare quotes" }).click();
  await expect(page.getByText("Sample quotes from Jane's demo carrier catalog")).toBeVisible();
  await page.getByRole("button", { name: "Get quotes" }).click();
  const lighthouse = page.getByRole("listitem").filter({ hasText: "Lighthouse Insurance (demo)" });
  await expect(lighthouse.getByText("Same cover and deductible as your policy.")).toBeVisible();
  await expect(
    lighthouse.getByText("$1,296.00 a year, $408.00 less than you pay now."),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

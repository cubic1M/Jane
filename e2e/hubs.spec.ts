import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// The Jane, Money and Ahead hubs (spec step 80), filled by the demo bank: each shows its
// sections and live numbers, and its tiles open the full pages.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const DOLLARS = /\$[\d,]+\.\d{2}/;

test("the hubs gather every page, with live numbers from the demo bank", async ({
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
  // The scan ends in Jane's chat (spec step 82).
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  // Jane: what's to decide, with Jane's pick where there's one.
  await page.goto("/jane");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What Jane is doing for you");
  for (const name of ["To decide", "In progress", "Done", "Alerts"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(
    page.getByText(/things to look at, worth up to about \$[\d,]+\.\d{2} a year/),
  ).toBeVisible();
  await expect(page.getByText(/^Jane's pick: /).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "See the full plan" })).toHaveAttribute(
    "href",
    "/plan",
  );
  await page.locator('main a[href^="/report/"]').first().click();
  await expect(page).toHaveURL(/\/report\/[\w-]+$/);

  // Money: the picture, grouped, each tile with its number.
  await page.goto("/money");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your money");
  for (const name of ["What you have", "What goes out", "What you owe", "Your files"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  const netWorth = page.getByRole("listitem").filter({ hasText: "Net worth" });
  await expect(netWorth).toContainText(DOLLARS);
  await expect(page.getByRole("listitem").filter({ hasText: "Loans and cards" })).toContainText(
    DOLLARS,
  );
  await expect(page.getByRole("link", { name: "Things you own" })).toBeVisible();
  await page.getByRole("link", { name: "Coming up" }).click();
  await expect(page).toHaveURL("/bills");

  // Ahead: planning, with the yearly set-aside and the next deadline.
  await page.goto("/ahead");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan ahead");
  for (const name of ["Coming up", "Get ready", "Look back"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole("listitem").filter({ hasText: "Yearly bills" })).toContainText(
    /\$[\d,]+\.\d{2} a month/,
  );
  await expect(page.getByRole("listitem").filter({ hasText: "Deadlines" })).toContainText(/Next: /);
  await page.getByRole("link", { name: "Yearly bills" }).click();
  await expect(page).toHaveURL("/budgets#yearly");
  await expect(page.getByRole("heading", { name: "Set aside for yearly bills" })).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { expectFinding } from "./report-page";

// A messy real bank (founder, 2026-10-26), through the CSV import: Chase checking and savings
// exports and two card exports that overlap by a month (e2e/fixtures/messy). Card payments,
// transfers to savings and to themselves never show as spending or bills, coffee three times a
// week isn't a subscription, and the price rise is found. src/lib/messy-bank.integration.test.ts
// pins the numbers. And while the first scan runs, the report says so instead of "Nothing to fix".

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser();
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  return user.userId;
}

async function addAccount(page: Page, name: string, type: string, balance: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Type").selectOption({ label: type });
  await page.getByLabel("Current balance").fill(balance);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByRole("option", { name: new RegExp(`^${name} `) })).toHaveCount(1);
}

async function importInto(page: Page, account: string, files: string[]) {
  await page.goto("/import");
  await page.getByRole("combobox", { name: "Account" }).selectOption({ label: account });
  await page
    .locator('input[type="file"]')
    .setInputFiles(files.map((f) => `e2e/fixtures/messy/${f}`));
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
  await expect(page).toHaveURL("/report", { timeout: 90_000 });
}

test("a messy bank's exports: nothing counted twice, no false subscriptions, no transfer bills", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.goto("/import");
  await addAccount(page, "Chase Checking", "Checking", "2875.33");
  await addAccount(page, "Chase Savings", "Savings", "6140.26");
  await addAccount(page, "Chase Freedom", "Credit card", "412.10");
  await importInto(page, "Chase Checking (Checking)", ["checking.csv"]);
  await importInto(page, "Chase Savings (Savings)", ["savings.csv"]);
  // Both card exports in one upload: the month they share is read once.
  await importInto(page, "Chase Freedom (Credit card)", ["card-jul-sep.csv", "card-aug-oct.csv"]);

  // The report: the price rise, and no coffee, Amazon or card payment as something to fix.
  await expectFinding(page, /Netflix went up from \$15\.49 to \$17\.99/);
  const report = page.getByRole("main");
  await expect(report).not.toContainText(/Joes Coffee|Autopay|Transfer/i);

  await page.goto("/subscriptions");
  const subscriptions = page.getByRole("main");
  for (const name of ["Netflix", "Spotify", "Planet Fitness"]) {
    await expect(subscriptions.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(subscriptions).not.toContainText(/Joes Coffee|Amzn|Wholefds|Autopay|Transfer/i);

  await page.goto("/bills");
  await expect(page.getByRole("heading", { name: "Coming up", level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(/Autopay|Online Transfer|Venmo|Zelle/i);

  // Where the money goes: the card's purchases once, never the payments that paid it off.
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Where your money goes" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    /Crd Autopay|Online Transfer|Venmo|Zelle/i,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("while the first scan runs, the report says Jane is still reading", async ({
  page,
  baseURL,
}) => {
  const id = await signIn(page, baseURL);
  // Transactions read, and detection not finished yet.
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const account = `acc${crypto.randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO accounts (id, user_id, source, name, type, subtype, current_balance_cents, updated_at)
       VALUES ($1, $2, 'csv', 'Chase Checking', 'depository', 'checking', 287533, now())`,
      [account, id],
    );
    await client.query(
      `INSERT INTO transactions (id, user_id, account_id, source, dedupe_key, date, amount_cents, description, pending, updated_at)
       VALUES ($1, $2, $3, 'csv', $1, '2026-10-14', 1799, 'PAYPAL *NETFLIX', false, now())`,
      [`tx${crypto.randomUUID().replaceAll("-", "")}`, id, account],
    );
  } finally {
    await client.end();
  }

  await page.goto("/report");
  await expect(
    page.getByRole("heading", { name: "Still reading your accounts", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Reading your transactions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What Jane is checking" })).toBeVisible();
  await expect(page.getByText("Nothing to fix right now")).toHaveCount(0);
});

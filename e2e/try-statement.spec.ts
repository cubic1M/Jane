import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { madeUpChaseCsv } from "../src/lib/__fixtures__/made-up-statement";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// "Try it with your own statement" from the landing page, with a made-up statement: no email, a
// new temporary person each start, their own numbers under real-account rules, a Yes that gives
// the steps, "Start over" that really deletes, and two browsers that never see each other's rows.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

const BANNER = "[data-temporary-try]";

async function query<T>(sql: string, values: unknown[]): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, values)).rows as T[];
  } finally {
    await client.end();
  }
}

// Every browser here comes from one address, and these tests start more than one address may in
// an hour: the limit itself is tested in src/app/try/statement-actions.test.ts.
test.beforeEach(async () => {
  await query("DELETE FROM rate_limits WHERE key LIKE 'trialStatement%'", []);
});

// Whose session this browser holds, from the cookie the app set.
async function personIn(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name.endsWith("authjs.session-token"));
  if (!session) return null;
  const rows = await query<{ user_id: string }>(
    "SELECT user_id FROM sessions WHERE session_token = $1",
    [session.value],
  );
  return rows[0]?.user_id ?? null;
}

async function startWith(page: Page, marker: string) {
  await page.goto("/?try=upload");
  const box = page.locator("#try-upload");
  // The link opens it directly.
  await expect(box.locator('input[type="file"]')).toBeVisible();
  await box.locator('input[type="file"]').setInputFiles({
    name: `${marker}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(madeUpChaseCsv(marker)),
  });
  await box.getByRole("checkbox").check();
  await box.getByRole("button", { name: "Read my statement" }).click();
  await expect(page.locator(BANNER)).toBeVisible({ timeout: 90_000 });
  await expect(page).toHaveURL(/\/report/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/We found/, { timeout: 90_000 });
}

test("a visitor starts, sees their own numbers, gets the steps, and starts over", async ({
  page,
}) => {
  await startWith(page, "ZZFIRST");
  const person = await personIn(page);
  expect(person).toMatch(/^trial_own_/);

  // The banner says what this is, and nothing says sample data or demo advice.
  const banner = page.locator(BANNER);
  await expect(banner).toContainText("temporary");
  await expect(banner).toContainText("your own statement");
  await expect(banner).toContainText("within 48 hours");
  await expect(page.locator("body")).not.toContainText("fake data");
  await expect(page.locator("body")).not.toContainText("sample person");
  await expect(page.locator("body")).not.toContainText("Demo advice");

  // Their own rows.
  await page.goto("/transactions");
  await expect(page.getByText("ZZFIRST", { exact: false }).first()).toBeVisible();

  // Reloading changes nothing: same person, same rows.
  await page.reload();
  expect(await personIn(page)).toBe(person);
  await expect(page.getByText("ZZFIRST", { exact: false }).first()).toBeVisible();

  // A Yes gives the do-it-yourself steps, and nobody acts for them.
  await page.goto("/report");
  await page.locator('a[href^="/report/"]').first().click();
  await page.getByRole("button", { name: "Show me how" }).first().click();
  await expect(page.getByRole("button", { name: /Mark (it )?done/ })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).not.toContainText("Jane wrote to the company");
  await expect(main).not.toContainText("Jane will cancel");
  await expect(main).not.toContainText("our team");
  const [{ actions }] = await query<{ actions: string }>(
    "SELECT count(*) AS actions FROM actions WHERE user_id = $1",
    [person],
  );
  expect(Number(actions)).toBe(0);
  const [{ decisions }] = await query<{ decisions: string }>(
    "SELECT count(*) AS decisions FROM decisions WHERE user_id = $1 AND choice = 'diy'",
    [person],
  );
  expect(Number(decisions)).toBe(1);

  // No bank link and no demo bank for them.
  await page.goto("/connect");
  await expect(page.getByRole("button", { name: "Link a demo bank" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Link (your|an)/ })).toHaveCount(0);

  // The banner's is the only Start over: /import's keeps a person, and this person doesn't last.
  await page.goto("/import");
  await expect(page.locator("[data-start-over]")).toHaveCount(0);
  await expect(page.locator("[data-positions-link]")).toHaveCount(0);

  // What this tab kept about them, to check it goes.
  await page.evaluate(() => sessionStorage.setItem("jane:dock-cards", "[]"));

  // Start over deletes them now.
  await page.locator("[data-start-over-try]").click();
  await expect(page).toHaveURL(/\?try=upload&deleted=1/);
  await expect(page.locator("[data-try-deleted]")).toBeVisible();
  expect(await personIn(page)).toBeNull();
  const left = await query<{ n: string }>("SELECT count(*) AS n FROM users WHERE id = $1", [
    person,
  ]);
  expect(Number(left[0].n)).toBe(0);
  const rows = await query<{ n: string }>(
    "SELECT count(*) AS n FROM transactions WHERE user_id = $1",
    [person],
  );
  expect(Number(rows[0].n)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem("jane:dock-cards"))).toBeNull();
  const audit = await query<{ event: string }>(
    "SELECT event FROM audit_log WHERE target_id = $1 ORDER BY created_at",
    [person],
  );
  expect(audit.map((r) => r.event).sort()).toEqual([
    "statement_trial_deleted",
    "statement_trial_started",
  ]);

  // Back doesn't bring anything back.
  await page.goBack();
  await expect(page.getByText("ZZFIRST", { exact: false })).toHaveCount(0);
});

test("a second start in the same browser deletes the first and starts empty", async ({ page }) => {
  await startWith(page, "ZZONE");
  const first = await personIn(page);
  await startWith(page, "ZZTWO");
  const second = await personIn(page);
  expect(second).not.toBe(first);
  expect(second).toMatch(/^trial_own_/);
  const left = await query<{ n: string }>("SELECT count(*) AS n FROM users WHERE id = $1", [first]);
  expect(Number(left[0].n)).toBe(0);
  await page.goto("/transactions");
  await expect(page.getByText("ZZTWO", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("ZZONE", { exact: false })).toHaveCount(0);
  await deleteUser(second!);
});

async function visitor(browser: Browser, marker: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await startWith(page, marker);
  return { context, page, person: (await personIn(page))! };
}

test("two browsers at once never see each other, and one's links don't open for the other", async ({
  browser,
}) => {
  const [a, b] = await Promise.all([visitor(browser, "ZZALPHA"), visitor(browser, "QQBRAVO")]);
  expect(a.person).not.toBe(b.person);

  await a.page.goto("/transactions");
  await expect(a.page.getByText("ZZALPHA", { exact: false }).first()).toBeVisible();
  await expect(a.page.getByText("QQBRAVO", { exact: false })).toHaveCount(0);
  await b.page.goto("/transactions");
  await expect(b.page.getByText("QQBRAVO", { exact: false }).first()).toBeVisible();
  await expect(b.page.getByText("ZZALPHA", { exact: false })).toHaveCount(0);

  // A's finding, opened in B's browser: not found.
  await a.page.goto("/report");
  const link = await a.page.locator('a[href^="/report/"]').first().getAttribute("href");
  await a.page.goto(link!);
  await expect(a.page.getByRole("button", { name: "Show me how" }).first()).toBeVisible();
  await b.page.goto(link!);
  await expect(b.page.getByText("Page not found")).toBeVisible();
  await expect(b.page.getByRole("button", { name: "Show me how" })).toHaveCount(0);

  // A starting over leaves B whole.
  await a.page.goto("/report");
  await a.page.locator("[data-start-over-try]").click();
  await expect(a.page).toHaveURL(/deleted=1/);
  await b.page.goto("/transactions");
  await expect(b.page.getByText("QQBRAVO", { exact: false }).first()).toBeVisible();

  await deleteUser(b.person);
  await a.context.close();
  await b.context.close();
});

test("someone signed in with a real account isn't signed out by trying this", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/?try=upload");
  const box = page.locator("#try-upload");
  await box.locator('input[type="file"]').setInputFiles({
    name: "mine.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(madeUpChaseCsv("ZZREAL")),
  });
  await box.getByRole("checkbox").check();
  await box.getByRole("button", { name: "Read my statement" }).click();
  await expect(box.getByRole("alert")).toContainText("You're signed in");
  expect(await personIn(page)).toBe(user.userId);
  await deleteUser(user.userId);
});

test("a layout Jane doesn't know goes to the column picker, in a new temporary person", async ({
  page,
}) => {
  await page.goto("/?try=upload");
  const box = page.locator("#try-upload");
  await box.locator('input[type="file"]').setInputFiles({
    name: "other-bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("When,What,How much\n2026-10-14,Coffee,5.75\n2026-10-13,Lunch,12.00\n"),
  });
  await box.getByRole("checkbox").check();
  await box.getByRole("button", { name: "Read my statement" }).click();
  await expect(page).toHaveURL(/\/import\?columns=1/, { timeout: 60_000 });
  await expect(page.locator("[data-pick-columns]")).toContainText("pick which column is which");
  await expect(page.locator(BANNER)).toBeVisible();
  const person = await personIn(page);
  expect(person).toMatch(/^trial_own_/);
  await deleteUser(person!);
});

test("a file Jane can't read makes no one, and the box and a file are asked for", async ({
  page,
}) => {
  await page.goto("/?try=upload");
  const box = page.locator("#try-upload");
  await box.locator('input[type="file"]').setInputFiles({
    name: "notes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("just some words\n"),
  });
  await box.getByRole("checkbox").check();
  await box.getByRole("button", { name: "Read my statement" }).click();
  await expect(box.getByRole("alert")).toBeVisible();
  expect(await personIn(page)).toBeNull();
});

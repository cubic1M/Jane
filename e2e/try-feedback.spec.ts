import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { madeUpChaseCsv } from "../src/lib/__fixtures__/made-up-statement";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { demoPerson } from "./demo-person";

// During a try, Home asks what Jane got wrong (founder 11-04): a plain form, tied to no one.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function query<T>(sql: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, values)).rows as T[];
  } finally {
    await client.end();
  }
}

const countOf = async (event: string) => {
  const [{ sum }] = await query<{ sum: string | null }>(
    "SELECT sum(count) AS sum FROM try_stats WHERE event = $1",
    [event],
  );
  return Number(sum ?? 0);
};

test("a real upload moves the counts, and what's said outlives the try", async ({
  page,
  browser,
  baseURL,
}) => {
  await query("DELETE FROM rate_limits WHERE key LIKE 'trialStatement%'");
  const [started, finished, unreadable] = await Promise.all([
    countOf("started"),
    countOf("scan_finished"),
    countOf("unreadable"),
  ]);

  // A file Jane can't read is counted, and makes no one.
  await page.goto("/?try=upload");
  const upload = page.locator("#try-upload");
  await upload.locator('input[type="file"]').setInputFiles({
    name: "not-a-statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("this is not a statement"),
  });
  await upload.getByRole("checkbox").check();
  await upload.getByRole("button", { name: "Read my statement" }).click();
  await expect.poll(() => countOf("unreadable"), { timeout: 30_000 }).toBeGreaterThan(unreadable);

  await page.goto("/?try=upload");
  await upload.locator('input[type="file"]').setInputFiles({
    name: "ZZFEEDBACK.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(madeUpChaseCsv("ZZFEEDBACK", new Date())),
  });
  await upload.getByRole("checkbox").check();
  await upload.getByRole("button", { name: "Read my statement" }).click();
  await expect(page).toHaveURL(/\/report/, { timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/We found/, { timeout: 90_000 });
  expect(await countOf("started")).toBe(started + 1);
  await expect.poll(() => countOf("scan_finished"), { timeout: 60_000 }).toBe(finished + 1);

  // The box is on the first findings someone sees. An email in it doesn't get kept.
  const words = `Rent is not a bill ${crypto.randomUUID().slice(0, 8)}`;
  const box = page.locator("[data-try-feedback]");
  await box.getByLabel("What did Jane get wrong?").fill(`${words} sam@example.com`);
  await box.getByRole("button", { name: "[SEND]" }).click();
  await expect(page.locator("[data-try-feedback-sent]")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/report\?feedback=sent/);

  // Starting over deletes the person; the words stay, tied to no one.
  await page.locator("[data-start-over-try]").click();
  await expect(page).toHaveURL(/deleted=1/, { timeout: 60_000 });

  const admin = await signedInUser("admin");
  userId = admin.userId;
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: admin.sessionToken, url: baseURL ?? "" },
  ]);
  const adminPage = await context.newPage();
  await adminPage.goto("/admin/reports");
  const row = adminPage.locator("[data-try-feedback-row]").filter({ hasText: words });
  await expect(row).toContainText("[email]");
  await expect(row).not.toContainText("sam@example.com");
  await expect(row).toContainText("their own statement");
  await expect(adminPage.locator('[data-try-total="started"]')).toContainText(String(started + 1));
  await context.close();
});

test("someone not trying Jane isn't asked", async ({ page, context, baseURL }) => {
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  await expect(page.locator("[data-net-worth-chart]")).toBeVisible();
  await expect(page.locator("[data-try-feedback]")).toHaveCount(0);
});

test("a sample try can say what Jane got wrong, and is thanked", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await page.waitForURL(/\/home/, { timeout: 90_000 });

  const box = page.locator("[data-try-feedback]");
  await expect(box).toBeVisible({ timeout: 60_000 });
  await expect(box).toContainText("isn't linked to you");
  await box.getByLabel("What did Jane get wrong?").fill("The rent looks like a subscription.");
  await box.getByRole("button", { name: "[SEND]" }).click();
  await expect(page.locator("[data-try-feedback-sent]")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/feedback=sent/);
});

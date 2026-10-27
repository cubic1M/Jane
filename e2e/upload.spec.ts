import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { TERMS_VERSION } from "../src/config/legal";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Upload first (closed beta, founder: linking feels scary): a new person starts on /connect
// with "Upload your statements", downloads from their bank with the steps on /import, uploads a
// Bank of America export or a CSV in a layout Jane doesn't know (the column picker), and lands
// on the report like someone who linked a bank. Trial people can't upload. The team sees the
// beta's numbers on /admin/metrics.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
// The dev server compiles each page on first visit.
test.setTimeout(150_000);

const FIXTURES = "src/data-sources/csv/__fixtures__";

let userId: string | undefined;

test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

async function signIn(page: Page, baseURL: string | undefined, role: "user" | "admin" = "user") {
  const user = await signedInUser(role);
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

async function uploadFile(page: Page, file: string) {
  await page.locator('input[type="file"]').setInputFiles(`${FIXTURES}/${file}`);
  await page.getByRole("button", { name: "Preview" }).click();
}

test("a new person starts with uploading, and lands on the report", async ({ page, baseURL }) => {
  await signIn(page, baseURL);

  // Onboarding: with nothing added yet, Home sends them to /connect, which leads with upload.
  await page.goto("/home");
  await expect(page).toHaveURL("/connect", { timeout: 60_000 });
  const upload = page.locator("[data-upload-first]");
  await expect(upload.getByRole("heading", { name: "Upload your statements" })).toBeVisible();
  await expect(
    upload.getByText("Files are read once and never stored, and Jane never sees your bank login."),
  ).toBeVisible();
  // The demo bank stays offered, below.
  await expect(page.getByRole("button", { name: "Link a demo bank" })).toBeVisible();

  await upload.getByRole("link", { name: "Upload your statements" }).click();
  await expect(page).toHaveURL("/import");
  await expect(
    page.getByRole("heading", { name: "Upload your statements", level: 1 }),
  ).toBeVisible();

  // Plain steps per bank.
  const steps = page.locator("[data-bank-steps]");
  await steps.getByText("How to download from your bank").click();
  await expect(steps.getByText("Bank of America", { exact: true })).toBeVisible();
  await expect(steps.getByText('Choose "Download Account Activity".')).toBeVisible();

  // No account to add first: the upload makes one from the file, the balance optional.
  await expect(page.locator('select[name="accountId"]')).toHaveValue("new");
  await uploadFile(page, "bofa-checking.csv");
  await expect(page.getByText("Bank of America checking or savings · 4 rows")).toBeVisible();
  const account = page.locator("[data-new-account]");
  await expect(account.locator('[name="new.name"]')).toHaveValue("Bank of America checking");
  await expect(account.locator('[name="new.kind"]')).toHaveValue("checking");
  await expect(account.locator('[name="new.balance"]')).toHaveValue("");
  // Two weeks of statements: ask for three months.
  await expect(page.locator("[data-upload-months]")).toContainText("cover 14 days");

  // Saved at once, the rest in the background: the chip at the top follows it.
  await page.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(page.locator("[data-import-saved]")).toContainText("Saved 4 transactions");
  // Said once: no second paragraph repeating where the progress shows.
  await expect(page.locator("[data-import-saved]")).not.toContainText("Keep using Jane meanwhile");
  await expect(page.locator("[data-import-chip]")).toBeVisible();
  // Only on the page: never again inside the docked chat's frame (QA: it covered the chat).
  await expect(
    page.frameLocator('iframe[title="Chat with Jane"]').locator("[data-import-chip]"),
  ).toHaveCount(0);
  await waitForImport(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /We found|Nothing to fix right now/,
    { timeout: 60_000 },
  );
  await expect(page.locator("[data-more-months]")).toContainText("Upload 3 months");
  await page.getByText(/^Accounts we read/).click();
  await expect(page.getByText("Bank of America checking").first()).toBeVisible();
});

test("a CSV in an unknown layout gets a column picker instead of failing", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.goto("/import");
  await uploadFile(page, "custom-signed.csv");

  const picker = page.locator("[data-column-picker]");
  await expect(picker.getByText("Which column is which in custom-signed.csv?")).toBeVisible();
  // Guessed from the values: the dates, the longest text and the number.
  await expect(picker.locator('[name="map.0.date"]')).toHaveValue("0");
  await expect(picker.locator('[name="map.0.description"]')).toHaveValue("1");
  await expect(picker.locator('[name="map.0.amount"]')).toHaveValue("2");
  // Jane's guess at the sign, shown to check: the coffee is spending, and it's negative.
  await expect(picker.locator('[name="map.0.out"]')).toHaveValue("negative");
  await expect(picker.locator("[data-sign-guess]")).toHaveText(
    'Jane\'s guess: from rows like "COFFEE PLACE". Check the amounts in the preview.',
  );

  await page.getByRole("button", { name: "Preview again" }).click();
  await expect(page.getByText("Columns you picked · 3 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "COFFEE PLACE" })).toBeVisible();
  await page.locator('[data-new-account] [name="new.name"]').fill("Credit union");
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await waitForImport(page);
});

test("the picker reads day-first dates, guesses positive spending, and asks when unsure", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.goto("/import");
  const picker = page.locator("[data-column-picker]");

  // 13/09 and 14/09 settle it: day first, so 05/09 is 5 September.
  await uploadFile(page, "day-first.csv");
  await expect(picker.locator('[name="map.0.dates"]')).toHaveValue("dmy");
  await page.getByRole("button", { name: "Preview again" }).click();
  await expect(page.getByRole("cell", { name: "2026-09-05" })).toBeVisible();

  // Spending shown as positive: Jane says so, from a grocery row.
  await uploadFile(page, "spending-positive.csv");
  await expect(picker.locator('[name="map.0.out"]')).toHaveValue("positive");
  await expect(picker.locator("[data-sign-guess]")).toContainText("WHOLE FOODS MARKET");

  // 05/09 and 06/09 can't tell: the person must say.
  await uploadFile(page, "ambiguous-dates.csv");
  await expect(picker.locator('[name="map.0.dates"]')).toHaveValue("");
  await expect(picker.getByText("Jane can't tell from the dates in this file.")).toBeVisible();
  await picker.locator('[name="map.0.dates"]').selectOption("dmy");
  await page.getByRole("button", { name: "Preview again" }).click();
  await expect(page.getByRole("cell", { name: "2026-09-06" })).toBeVisible();
});

test("a web page saved as .csv is refused before the picker", async ({ page, baseURL }) => {
  await signIn(page, baseURL);
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("<!DOCTYPE html><html><body><h1>Sign in</h1></body></html>"),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(
    page.getByText(
      "statement.csv: This isn't a CSV statement. Download the CSV from your bank's website.",
    ),
  ).toBeVisible();
  await expect(page.locator("[data-column-picker]")).toHaveCount(0);
});

test("trial people (sample data) can't upload", async ({ page, baseURL }) => {
  const id = `trial_e2e${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, role, terms_version, terms_accepted_at, updated_at)
       VALUES ($1, $2, 'user', $3, now(), now())`,
      [id, `${id}@try.jane.invalid`, TERMS_VERSION],
    );
    await client.query(
      `INSERT INTO sessions (id, session_token, user_id, expires)
       VALUES ($1, $2, $1, now() + interval '1 day')`,
      [id, `e2e-session-${id}`],
    );
  } finally {
    await client.end();
  }
  userId = id;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: `e2e-session-${id}`, url: baseURL ?? "" }]);

  await page.goto("/import");
  await expect(page).toHaveURL("/connect", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Connect your accounts" })).toBeVisible();
  await expect(page.locator("[data-upload-first]")).toHaveCount(0);
});

test("the team sees the closed beta's numbers", async ({ page, baseURL }) => {
  await signIn(page, baseURL, "admin");
  await page.goto("/admin/metrics");
  const beta = page.locator("[data-beta-metrics]");
  await expect(beta.getByRole("heading", { name: "Closed beta" })).toBeVisible({ timeout: 60_000 });
  for (const row of [
    "Invited (redeemed a code)",
    "Signed up",
    "Added accounts by upload",
    "Linked accounts with Plaid",
    "People with at least one finding",
    "Found, total per year",
    "Found, median per person per year",
    "People who acted on at least one card",
    "Verified savings so far",
  ]) {
    await expect(beta.getByRole("rowheader", { name: row })).toBeVisible();
  }
});

test('the same file again says nothing was new, not "Saved 0 transactions"', async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.goto("/import");
  await uploadFile(page, "chase-checking.csv");
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await waitForImport(page, { open: "/import" });

  // Back on /import, the account choice opens on that account; the same file into it.
  await expect(page.locator('select[name="accountId"] option:checked')).toContainText("Chase");
  await uploadFile(page, "chase-checking.csv");
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await expect(page.locator("[data-import-saved]")).toContainText(
    /^Nothing new: Jane already had all \d+ of these transactions\./,
  );
});

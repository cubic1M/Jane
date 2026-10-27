import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";
import { TERMS_VERSION } from "../src/config/legal";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

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

async function addAccount(page: Page, name: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Type").selectOption({ label: "Checking" });
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText(name).first()).toBeVisible();
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

  await addAccount(page, "BofA checking");
  await page.locator('input[type="file"]').setInputFiles(`${FIXTURES}/bofa-checking.csv`);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("Bank of America checking or savings · 4 rows")).toBeVisible();
  // Two weeks of statements: ask for three months.
  await expect(page.locator("[data-upload-months]")).toContainText("cover 14 days");

  await page.getByRole("button", { name: "Import 4 transactions" }).click();
  await expect(page).toHaveURL("/report", { timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /We found|Nothing to fix right now/,
    { timeout: 60_000 },
  );
  await expect(page.locator("[data-more-months]")).toContainText("Upload 3 months");
});

test("a CSV in an unknown layout gets a column picker instead of failing", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL);
  await page.goto("/import");
  await addAccount(page, "Credit union");
  await page.locator('input[type="file"]').setInputFiles(`${FIXTURES}/custom-signed.csv`);
  await page.getByRole("button", { name: "Preview" }).click();

  const picker = page.locator("[data-column-picker]");
  await expect(picker.getByText("Which column is which in custom-signed.csv?")).toBeVisible();
  // Guessed from the values: the dates, the longest text and the number.
  await expect(picker.getByLabel("Date")).toHaveValue("0");
  await expect(picker.getByLabel("Description")).toHaveValue("1");
  await expect(picker.getByLabel("Amount")).toHaveValue("2");
  await picker.getByLabel("Money you spent shows as").selectOption("negative");

  await page.getByRole("button", { name: "Preview again" }).click();
  await expect(page.getByText("Columns you picked · 3 rows")).toBeVisible();
  await expect(page.getByRole("cell", { name: "COFFEE PLACE" })).toBeVisible();
  await page.getByRole("button", { name: "Import 3 transactions" }).click();
  await expect(page).toHaveURL("/report", { timeout: 90_000 });
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

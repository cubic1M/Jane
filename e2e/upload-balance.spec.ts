import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// A card's statement has no balance (CSV bench: card debt missing from most upload-only
// people's net worth). Right after the upload Jane asks what's owed; skipped, net worth says on
// Home, the money page and /net-worth that it isn't counting the card; given, the debt counts.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const usDate = (d: Date) =>
  `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

// Checking with its running balance ($2,000.00 today), so net worth is known but for the card.
function checkingFile(): string {
  const d = usDate(new Date(Date.now() - 3 * 86_400_000));
  return [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    `CREDIT,${d},"ACME CORP PAYROLL PPD",2000.00,ACH_CREDIT,2000.00,,`,
  ].join("\n");
}

function cardFile(): string {
  const lines = ["Transaction Date,Post Date,Description,Category,Type,Amount,Memo"];
  for (let n = 60; n >= 1; n -= 5) {
    const d = usDate(new Date(Date.now() - n * 86_400_000));
    lines.push(`${d},${d},UBER   *TRIP,Travel,Sale,-18.00,`);
    // Interest every month: money found, so the chip has a "found" to (not) say later.
    if (n % 25 === 5)
      lines.push(`${d},${d},PURCHASE INTEREST CHARGE,Fees & Adjustments,Fee,-31.40,`);
  }
  return lines.join("\n");
}

test("a card without a balance is asked for, and net worth says it isn't counted until then", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);

  // First a checking account, whose file says its balance: nothing is asked.
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "checking.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(checkingFile()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await expect(page.locator("[data-import-saved]")).toBeVisible();
  await expect(page.locator("[data-balance-ask]")).toHaveCount(0);
  // The next file is often another bank's: the choice stays on a new account, not the one just
  // made. (It used to switch to it, so a second bank's file landed in the first's account.)
  await expect(page.locator('select[name="accountId"]')).toHaveValue("new");
  await waitForImport(page, { open: "/import" });

  await page.locator('select[name="accountId"]').selectOption("new");
  await page.locator('input[type="file"]').setInputFiles({
    name: "card.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(cardFile()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();

  // Asked at once, as one short field; skipping is allowed.
  const saved = page.locator("[data-import-saved]");
  await expect(saved.getByText("What do you owe on Chase card today?")).toBeVisible();
  await saved.getByRole("button", { name: "Skip for now" }).click();
  await expect(saved.getByText("What do you owe on Chase card today?")).toHaveCount(0);
  await waitForImport(page, { open: "/net-worth" });
  await expect(page.locator('[data-import-chip="done"]')).toContainText("found $");

  // Skipped: every net worth says what it isn't counting.
  await expect(page.locator("[data-net-worth-not-counting]")).toContainText(
    "Not counting your Chase card balance: the file doesn't say it yet.",
  );
  await page.goto("/home");
  await expect(page.locator("[data-net-worth-chart] [data-net-worth-not-counting]")).toContainText(
    "Not counting your Chase card balance",
  );
  await page.goto("/money");
  // Its tree folds the items under their branches: opened, the net worth item says so too.
  await page.getByRole("treeitem", { name: /What you have/ }).click();
  await expect(
    page.getByRole("treeitem", { name: /Net worth, not counting card balance/ }),
  ).toBeVisible();

  // Given later on /import: the debt counts, and the note goes.
  await page.goto("/import");
  // Said once, over the accounts, in the right number.
  await expect(
    page.getByText(
      "One statement doesn't say today's balance. Add it below and net worth counts it.",
    ),
  ).toBeVisible();
  const ask = page.locator("[data-uploaded-account] [data-balance-ask]");
  await ask.getByRole("textbox").fill("350.00");
  await ask.getByRole("button", { name: "Save" }).click();
  // Once saved, the page has no question left for it.
  await expect(page.locator("[data-balance-ask]")).toHaveCount(0);
  // An update: its chip says the numbers are up to date, not "found $376/yr" again.
  await expect(page.locator('[data-import-chip="done"]')).toContainText("up to date", {
    timeout: 120_000,
  });
  await expect(page.locator('[data-import-chip="done"]')).not.toContainText("found");
  // /loans says what's owed, and no "$0.00 due each month" for a card with no payment known.
  await page.goto("/loans");
  await expect(page.getByText(/^You owe \$350\.00\. Open a branch/)).toBeVisible();
  await page.goto("/net-worth");
  await expect(page.locator("[data-net-worth-not-counting]")).toHaveCount(0);
  await expect(
    page
      .locator("section div")
      .filter({ hasText: /^You owe/ })
      .first(),
  ).toContainText("$350.00");
});

test("with no balance known at all, /net-worth says so instead of $0.00", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "card.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(cardFile()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page, { open: "/net-worth" });
  await expect(page.locator("[data-net-worth-unknown]")).toContainText("Not known yet");
  await expect(page.getByText("$0.00")).toHaveCount(0);
});

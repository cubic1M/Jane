import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";

// Manager 11-16 (connectors roadmap: the federal autopay card must be live before Dec 31, 2026):
// a beta student whose only data is an uploaded checking statement paying Nelnet. The card is on
// Loans unasked, and its button opens the steps (Jane can't turn autopay on): sign in to the
// servicer, turn on Auto Pay, check it's on.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.skip(new Date() > new Date("2027-01-01T04:59:00Z"), "the autopay cut's enrolment has closed");
test.setTimeout(150_000);

const day = (offset: number) => {
  const d = new Date(Date.now() - offset * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};

// A made-up Bank of America checking export: pay, rent and three Nelnet payments, a month apart.
const statement = () =>
  [
    "Date,Description,Amount,Running Bal.",
    `${day(75)},"ACME CORP DES:PAYROLL ID:XXXXX4321 INDN:SAMPLE STUDENT","1,850.00","2,462.40"`,
    `${day(70)},"NELNET DES:STUDENT LN ID:XXXXX55 INDN:SAMPLE STUDENT","-212.40","2,250.00"`,
    `${day(45)},"ACME CORP DES:PAYROLL ID:XXXXX4321 INDN:SAMPLE STUDENT","1,850.00","4,100.00"`,
    `${day(40)},"NELNET DES:STUDENT LN ID:XXXXX55 INDN:SAMPLE STUDENT","-212.40","3,887.60"`,
    `${day(15)},"ACME CORP DES:PAYROLL ID:XXXXX4321 INDN:SAMPLE STUDENT","1,850.00","5,737.60"`,
    `${day(10)},"NELNET DES:STUDENT LN ID:XXXXX55 INDN:SAMPLE STUDENT","-212.40","5,525.20"`,
  ].join("\n");

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a student paying Nelnet from checking gets the autopay card and its steps", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await signInWith(page.context(), user.sessionToken, baseURL);

  await page.goto("/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "bofa-checking.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(statement()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await waitForImport(page, { open: "/loans" });

  const card = await pickItem(
    page,
    "Loans & credit",
    "Cheaper loans",
    "Student loan autopay by Dec 31",
  );
  await expect(card).toContainText(
    "Autopay with Nelnet by December 31, 2026 takes 1% off a federal loan's rate.",
  );

  await page.goto("/loans/student");
  const steps = page.locator("[data-autopay-steps]");
  await expect(steps.getByRole("heading", { name: "Autopay by December 31, 2026" })).toBeVisible();
  await expect(steps).toContainText("You pay Nelnet from checking.");
  await expect(steps).toContainText("about $10 a year for every $1,000 owed");
  await expect(steps.getByRole("link", { name: "Sign in to Nelnet" })).toHaveAttribute(
    "href",
    "https://nelnet.studentaid.gov",
  );
  await expect(steps.getByText("Turn on Auto Pay from your checking account.")).toBeVisible();
});

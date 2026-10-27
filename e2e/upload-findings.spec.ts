import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// What an uploaded statement's findings say. A card's interest from an upload is the charges seen,
// a year's worth: never "at today's balance", which Jane doesn't know (new-user pass, round 5).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// Capital One card, three months: interest every month.
function capitalOneCard(): string {
  const lines = ["Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit"];
  for (let n = 92; n >= 1; n--) {
    const d = new Date(Date.now() - n * 86_400_000);
    const day = isoDay(d);
    if (n % 3 === 0) lines.push(`${day},${day},1234,CHIPOTLE 1234,Dining,12.00,`);
    if (d.getUTCDate() === 23) {
      lines.push(`${day},${day},1234,INTEREST CHARGE:PURCHASES,Fee/Interest Charge,18.40,`);
    }
  }
  return lines.join("\n");
}

test("a card's interest from an upload reads as a year of it, not at today's balance", async ({
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
    name: "2026-10-27_transaction_download.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(capitalOneCard()),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await waitForImport(page);

  const interest = page.getByRole("link", { name: /in interest on Capital One card/ });
  await expect(interest).toContainText(/Could save about \$[\d,.]+ a year/);
  await expect(interest).not.toContainText("at today's balance");
});

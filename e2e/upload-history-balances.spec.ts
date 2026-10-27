import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";

// Net worth's months come from the statement's own balances: an older file added to the account,
// then the newer one removed, leaves the older months as the file said them, not worked back from
// today's balance across the missing weeks (new-user pass, round 8).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const pad = (n: number) => String(n).padStart(2, "0");
const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
const us = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;

// One Chase checking history from $1,000.00: pay on the 1st and 15th, rent on the 3rd.
function rows() {
  const out: { n: number; desc: string; cents: number; bal: number }[] = [];
  let bal = 100_000;
  for (let n = 120; n >= 1; n--) {
    const d = ago(n);
    const add = (desc: string, cents: number) => out.push({ n, desc, cents, bal: (bal += cents) });
    if (d.getUTCDate() === 1 || d.getUTCDate() === 15) add("ACME CORP PAYROLL PPD", 200_000);
    if (d.getUTCDate() === 3) add("ZELLE TO LANDLORD", -140_000);
  }
  return out;
}

function file(from: number, to: number) {
  const lines = ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #"];
  for (const r of rows()
    .filter((r) => r.n <= from && r.n >= to)
    .reverse()) {
    const kind = r.cents < 0 ? "DEBIT" : "CREDIT";
    lines.push(
      `${kind},${us(ago(r.n))},"${r.desc}",${(r.cents / 100).toFixed(2)},ACH,${(r.bal / 100).toFixed(2)},,`,
    );
  }
  return lines.join("\n");
}

test("an older file added, then the newer removed: the older months stay as the file said", async ({
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  const input = page.locator('input[type="file"]');
  const upload = async (name: string, text: string) => {
    await input.setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
    await page.getByRole("button", { name: /Preview/ }).click();
    await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
    await waitForImport(page, { open: "/import" });
  };

  await page.goto("/import");
  await upload("recent.CSV", file(45, 1));
  // The page opens on that account: the months before it, into it.
  await upload("earlier.CSV", file(120, 46));

  const recent = page.locator("[data-upload]").filter({ hasText: "recent.CSV" });
  const chip = page.locator("[data-import-chip]");
  const before = await chip.getAttribute("data-import-run");
  await recent.getByRole("button", { name: "Remove this upload" }).click();
  await recent.getByRole("button", { name: "Yes, remove them" }).click();
  await expect(page.locator("[data-upload]").filter({ hasText: "recent.CSV" })).toHaveCount(0);
  // The removal's own run, done.
  await expect(async () => {
    expect(await chip.getAttribute("data-import-chip")).toBe("done");
    expect(await chip.getAttribute("data-import-run")).not.toBe(before);
  }).toPass({ timeout: 120_000 });

  // The month before the first row: $1,000.00, as the file's first balance says.
  const first = ago(rows()[0].n);
  const monthEnd = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 0));
  const label = monthEnd.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  await page.goto("/net-worth");
  await expect(page.locator("li").filter({ hasText: label })).toContainText("$1,000.00");
});

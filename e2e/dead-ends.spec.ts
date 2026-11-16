import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { crawl } from "./crawl";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { waitForImport } from "./import-wait";
import { signInWith } from "./session";

// Gate A, "no dead ends" (mvp-ready.md in the lanes' notes, founder 11-15: "perfect mvp before
// actually letting the real ppl use it"). For each shape of a real (not demo) student's data, made
// the way a student makes it (statement uploads), the crawl (e2e/crawl.ts) follows every link from
// Home and opens every tree item and fold, and fails on an error, words saying a thing isn't for
// them, an empty heading, list or branch, a link that only reopens its own item, or a page with
// nowhere to go.
//
// Every PR runs the two shapes in CI_SHAPES (fewer pages); `CRAWL=all npx playwright test
// e2e/dead-ends.spec.ts` runs them all, deeper. Each run writes what it saw to
// test-results/dead-ends-<shape>.json.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");

const FULL = process.env.CRAWL === "all";
test.setTimeout(FULL ? 45 * 60_000 : 12 * 60_000);

// Fixed dates (fixtures never use today): a student-loan payment each month, in a checking file.
const LOAN_STATEMENT = [
  "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
  ...["10/03/2026", "09/03/2026", "08/03/2026", "07/03/2026"].map(
    (d, i) =>
      `DEBIT,${d},MOHELA STUDENT LOAN PMT PPD ID: 4440001,-212.40,ACH_DEBIT,${(3100 - i * 40).toFixed(2)},`,
  ),
  "CREDIT,10/01/2026,CAMPUS BOOKSTORE PAYROLL PPD ID: 7770002,1180.00,ACH_CREDIT,3312.40,",
  "CREDIT,09/01/2026,CAMPUS BOOKSTORE PAYROLL PPD ID: 7770002,1180.00,ACH_CREDIT,3272.40,",
].join("\n");

type Step = { statement: string } | { holdings: string };
const SHAPES: Record<string, Step[]> = {
  "checking-only": [{ statement: "e2e/fixtures/messy/checking.csv" }],
  "checking-card": [
    { statement: "e2e/fixtures/messy/checking.csv" },
    { statement: "e2e/fixtures/messy/card-aug-oct.csv" },
  ],
  "checking-card-loan": [
    { statement: "e2e/fixtures/messy/checking.csv" },
    { statement: "e2e/fixtures/messy/card-aug-oct.csv" },
    { statement: "loan" },
  ],
  "checking-brokerage": [
    { statement: "e2e/fixtures/messy/checking.csv" },
    { holdings: "src/data-sources/csv/__fixtures__/positions/fidelity.csv" },
  ],
  "one-month": [{ statement: "src/data-sources/csv/__fixtures__/chase-checking.csv" }],
  "old-statement": [{ statement: "src/data-sources/csv/__fixtures__/bofa-checking.csv" }],
};
const CI_SHAPES = ["checking-only", "checking-card"];

async function upload(page: Page, step: Step) {
  if ("holdings" in step) {
    await page.goto("/import/investments");
    await page.locator('input[type="file"]').setInputFiles(step.holdings);
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByRole("button", { name: "Import holdings" }).click();
    await expect(page.getByText(/^Saved \d+ holdings?/)).toBeVisible({ timeout: 60_000 });
    return;
  }
  await page.goto("/import");
  const file =
    step.statement === "loan"
      ? { name: "loan-payments.csv", mimeType: "text/csv", buffer: Buffer.from(LOAN_STATEMENT) }
      : step.statement;
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions?$/ }).click();
  await waitForImport(page, { open: "/home" });
}

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

for (const [shape, steps] of Object.entries(SHAPES)) {
  const inCi = CI_SHAPES.includes(shape);
  test(`no dead ends for a student with ${shape}${inCi ? " @critical" : ""}`, async ({
    page,
    baseURL,
    isMobile,
  }) => {
    test.skip(isMobile, "one crawl per shape; the walk matrix covers the phone");
    test.skip(!FULL && !inCi, "the full set runs with CRAWL=all");
    const user = await signedInUser("user");
    userId = user.userId;
    await signInWith(page.context(), user.sessionToken, baseURL);
    for (const step of steps) await upload(page, step);

    const lines: string[] = [];
    const result = await crawl(page, {
      origin: new URL(baseURL ?? "http://localhost:3000").origin,
      maxPages: FULL ? 250 : 80,
      maxDepth: FULL ? 5 : 3,
      log: (line) => lines.push(line),
    });
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      `test-results/dead-ends-${shape}.json`,
      JSON.stringify(
        { shape, pages: result.pages, findings: result.findings, log: lines },
        null,
        1,
      ),
    );
    expect(result.pages.length).toBeGreaterThan(5);
    expect(result.findings, `dead ends for ${shape}`).toEqual([]);
  });
}

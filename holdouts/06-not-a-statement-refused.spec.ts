import { expect, test } from "@playwright/test";
import {
  exportText,
  newPerson,
  pageText,
  personWithStatement,
  settled,
  submitStatementAtHome,
  visit,
} from "./person";
import { chaseChecking, monthly, NOT_STATEMENTS, ordinaryLife } from "./statements";

// A person's words, not a machine's.
const TECHNICAL =
  /(TypeError|ReferenceError|exception|stack trace|ENOENT|prisma|undefined|\bnull\b|internal server error|\b500\b|application error|something went wrong)/i;
// Says what is wrong with the file, or what to do about it.
const HELPFUL = /\b(csv|statement)\b/i;

function transactionCount(exported: string): number {
  return (JSON.parse(exported) as { transactions: unknown[] }).transactions.length;
}

test.describe("A file that isn't a statement, renamed .csv", () => {
  for (const [what, file] of Object.entries(NOT_STATEMENTS)) {
    test(`${what}, from the home page: refused kindly, and nothing is kept`, async ({
      browser,
      baseURL,
    }) => {
      const context = await newPerson(browser, baseURL!);
      const page = await submitStatementAtHome(context, file);
      await settled(page);

      // No rows, no account: if the visitor has anything now, it's empty.
      expect(new URL(page.url()).pathname).not.toMatch(/^\/report/);
      const download = await context.request.get("/api/export", { maxRedirects: 0 });
      if (download.status() === 200) {
        const held = JSON.parse(await download.text()) as {
          accounts: unknown[];
          transactions: unknown[];
        };
        expect(held.transactions, "no rows read from it").toEqual([]);
        expect(held.accounts, "no account made from it").toEqual([]);
      } else {
        expect(download.status(), "no person made for it").toBe(401);
      }

      // Told plainly that this isn't a statement.
      await expect(page.getByRole("alert").filter({ hasText: HELPFUL }).first()).toBeVisible();
      expect(await pageText(page)).not.toMatch(TECHNICAL);

      await context.close();
    });
  }

  test("for someone with data already: refused, and what they had is unchanged", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...monthly("NETFLIX.COM", -1549)]),
    );
    const before = await exportText(context);

    for (const [what, file] of Object.entries(NOT_STATEMENTS)) {
      await visit(page, "/import");
      await page.locator('input[type="file"]').first().setInputFiles(file);
      await page
        .getByRole("button", { name: /^preview/i })
        .first()
        .click();
      // The letter's refusal is the home page test's to check: here it's whether it changes anything.
      if (what !== "a letter") {
        await expect(
          page.getByRole("alert").filter({ hasText: HELPFUL }).first(),
          `${what} is refused in words`,
        ).toBeVisible();
      }
      await settled(page);
      expect(await pageText(page)).not.toMatch(TECHNICAL);
    }

    const after = await exportText(context);
    expect(transactionCount(after)).toBe(transactionCount(before));
    const accounts = (text: string) =>
      (JSON.parse(text) as { accounts: unknown[] }).accounts.length;
    expect(accounts(after)).toBe(accounts(before));

    await context.close();
  });
});

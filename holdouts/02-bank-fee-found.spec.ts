import { expect, test } from "@playwright/test";
import { pageText, personWithStatement, settled } from "./person";
import { bankOfAmericaChecking, monthly, ordinaryLife } from "./statements";

const STATEMENT = () =>
  bankOfAmericaChecking([...ordinaryLife(), ...monthly("ACCOUNT MAINTENANCE FEE", -995)]);

test.describe("A person paying the same bank fee every month", () => {
  test("uploads a statement and is shown the fee", async ({ browser, baseURL }) => {
    const { context, page } = await personWithStatement(browser, baseURL!, STATEMENT());

    // Six fees of $9.95 are $59.70 so far.
    const finding = page.getByRole("link", { name: /\bfees?\b/i }).first();
    await expect(finding).toBeVisible();
    await expect(finding).toContainText("$59.70");

    await finding.click();
    await page.waitForURL(/\/report\/.+/);
    await settled(page);

    const detail = await pageText(page);
    expect(detail).toMatch(/\bfees?\b/i);
    expect(detail).toContain("$9.95");
    expect(detail).toMatch(/maintenance fee/i);

    await context.close();
  });

  test("is told what it costs in a year: twelve fees, $119.40", async ({ browser, baseURL }) => {
    const { context, page } = await personWithStatement(browser, baseURL!, STATEMENT());

    const finding = page.getByRole("link", { name: /\bfees?\b/i }).first();
    await expect(finding).toBeVisible();
    await expect(finding).toContainText("$119.40");

    await context.close();
  });
});

import { expect, test } from "@playwright/test";
import { pageText, personWithStatement, visit } from "./person";
import { capitalOneCard, chaseChecking, monthly, ordinaryLife } from "./statements";

const MONTHLY = /(monthly|a month|per month|\/\s*mo\b|every month)/i;

test.describe("A person with a forgotten subscription", () => {
  test("uploads a bank statement and sees it found at the right monthly amount", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...monthly("NETFLIX.COM", -1549)]),
    );

    const finding = page.getByRole("link", { name: /netflix/i }).first();
    await expect(finding).toBeVisible();
    await finding.click();
    await page.waitForURL(/\/report\/.+/);

    // The finding says what they pay each month, and that a year of it is twelve of those.
    await expect(page.locator("body")).toContainText("$15.49");
    expect(await pageText(page)).toMatch(new RegExp(`\\$15\\.49\\s*${MONTHLY.source}`, "i"));
    await expect(page.locator("body")).toContainText("$185.88");

    // Their list of what charges them says the same.
    await visit(page, "/subscriptions");
    const list = await pageText(page);
    expect(list).toMatch(/netflix/i);
    expect(list).toMatch(new RegExp(`\\$15\\.49\\s*${MONTHLY.source}`, "i"));

    // Rent and groceries are real money, but nobody calls them subscriptions to review.
    await visit(page, "/report");
    await expect(page.getByRole("link", { name: /maple court.*subscription/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /corner grocery.*subscription/i })).toHaveCount(0);

    await context.close();
  });

  test("on a card statement with separate debit and credit columns, the amount is still right", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      capitalOneCard([
        ...monthly("SPOTIFY USA", -1199),
        { daysAgo: 20, description: "CORNER GROCERY STORE", cents: -4312 },
        { daysAgo: 55, description: "HARBOR HARDWARE", cents: -2750 },
        { daysAgo: 25, description: "PAYMENT THANK YOU", cents: 15_000 },
      ]),
    );

    await visit(page, "/subscriptions");
    const list = await pageText(page);
    expect(list).toMatch(/spotify/i);
    expect(list).toMatch(new RegExp(`\\$11\\.99\\s*${MONTHLY.source}`, "i"));
    expect(list).toContain("$143.88"); // twelve months of it

    await context.close();
  });
});

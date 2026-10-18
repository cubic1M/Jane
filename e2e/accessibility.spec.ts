import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Every page, signed out and in, light and dark: no serious or critical WCAG 2.1 A/AA
// problems found by axe (step 33). Desktop only; the pages are the same on phones.

test.setTimeout(300_000);

async function violations(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const SIGNED_OUT = ["/", "/login", "/signup", "/privacy", "/terms", "/security", "/offline"];
const SIGNED_IN = [
  "/home",
  "/report",
  "/actions",
  "/insights",
  "/transactions",
  "/budgets",
  "/goals",
  "/net-worth",
  "/bills",
  "/alerts",
  "/ask",
  "/settings",
  "/household",
  "/debt",
  "/year",
  "/subscriptions",
  "/connect",
  "/import",
];
const ADMIN = [
  "/admin/queue",
  "/admin/metrics",
  "/admin/merchants",
  "/admin/partners",
  "/admin/invites",
  "/admin/errors",
  "/admin/launch",
  "/admin/jobs",
  "/admin/replies",
  "/admin/health",
];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} mode`, () => {
    test.use({ colorScheme });

    test("signed-out pages", async ({ page }) => {
      test.skip(test.info().project.name !== "chromium", "desktop only");
      const found: string[] = [];
      for (const path of SIGNED_OUT) found.push(...(await violations(page, path)));
      expect(found).toEqual([]);
    });

    test("signed-in and team pages", async ({ context, page, baseURL }) => {
      test.skip(test.info().project.name !== "chromium", "desktop only");
      test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
      const user = await signedInUser("admin");
      try {
        await context.addCookies([
          { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
        ]);
        await page.goto("/import");
        await page.getByLabel("Name").fill("Test Card");
        await page.getByLabel("Type").selectOption({ label: "Credit card" });
        await page.getByRole("button", { name: "Add account" }).click();
        await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/sample-card.csv");
        await page.getByRole("button", { name: "Preview" }).click();
        await page.getByRole("button", { name: /Import \d+ transactions/ }).click();
        await expect(page).toHaveURL("/report", { timeout: 30_000 });
        const card = await page.getByRole("link", { name: /Netflix went up/ }).getAttribute("href");

        const found: string[] = [];
        for (const path of [...SIGNED_IN, card ?? "/report", ...ADMIN]) {
          found.push(...(await violations(page, path)));
        }
        expect(found).toEqual([]);
      } finally {
        await deleteUser(user.userId);
      }
    });
  });
}

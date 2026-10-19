import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Taxes (spec steps 118–127): what Jane found in the demo bank is shown as found, and the
// person's answers are saved from the profile page. No serious accessibility problems.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function axe(page: Page) {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${page.url()} ${v.id}`);
}

test("the tax profile shows what Jane found and saves the person's answers", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  await page.goto("/taxes");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Taxes: 2026");
  // Spec step 120: the estimate, from the demo bank's sample pay stubs.
  const estimate = page.getByRole("region", { name: "Your 2026 estimate" });
  await expect(estimate.getByText(/^Federal: a refund of about \$[\d,]+\.$/)).toBeVisible();
  await expect(estimate.getByText(/^California: /)).toBeVisible();
  await expect(estimate.getByText("Estimate", { exact: true })).toBeVisible();
  // Spec step 121: what to put on a new W-4, as labelled demo advice.
  const withholding = page.getByRole("region", { name: "Withholding" });
  await expect(withholding.getByText("What to put on a new W-4")).toBeVisible();
  await expect(withholding.getByRole("note")).toHaveText(
    "Demo advice: sample data, not financial advice",
  );
  // Spec step 122: ways to pay less, each an estimate with its button.
  const savings = page.getByRole("region", { name: "Ways to pay less" });
  await expect(savings.getByRole("heading", { name: /into your 401\(k\)/ })).toBeVisible();
  await expect(savings.getByRole("button", { name: "Remind me" })).toBeVisible();
  // Spec step 124: gains from the demo brokerage, and its wash sale.
  const investments = page.getByRole("region", { name: "Investments" });
  await expect(investments.getByText(/^Wash sale: PDIFX sold at a loss/)).toBeVisible();
  const profile = page.getByRole("region", { name: "Your tax profile" });
  await expect(profile.getByText("California")).toBeVisible();
  await expect(profile.getByText("Found by Jane: check it").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "What Jane does by herself" })).toContainText(
    "Nothing is ever filed, signed or paid without your tap.",
  );
  expect(await axe(page)).toEqual([]);

  await profile.getByRole("link", { name: "Finish it" }).click();
  await expect(page).toHaveURL("/taxes/profile");
  await expect(page.getByText("Found by Jane: ACME CORP PAYROLL")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Wages from a job/ })).toBeChecked();
  await page.getByRole("radio", { name: "Head of household" }).check();
  await page.getByLabel("Children under 17 you claim").fill("1");
  await page.getByRole("button", { name: "Save my answers" }).click();
  await expect(page.getByRole("status").first()).toHaveText(
    "Saved. I'll use these for your taxes.",
  );
  expect(await axe(page)).toEqual([]);

  await page.goto("/taxes");
  await expect(profile.getByText("Head of household")).toBeVisible();
  await expect(profile.getByText("1 under 17, 0 other")).toBeVisible();
  await expect(profile.getByText("Found by Jane: check it")).toHaveCount(0);

  // Spec step 119: the forms to expect, ticked off from the page.
  const forms = page.getByRole("region", { name: /Tax forms to expect/ });
  await expect(forms.getByText("ACME CORP PAYROLL")).toBeVisible();
  await forms.getByRole("button", { name: "I have it: W-2 from ACME CORP PAYROLL" }).click();
  await expect(forms.getByRole("status").first()).toHaveText(
    "Ticked off: W-2 from ACME CORP PAYROLL.",
  );
});

test("tax tags: Jane's tags, her questions, and tagging a work expense", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/connect");
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });

  await page.goto("/taxes/tags");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tax tags: 2026");
  await expect(page.getByRole("region", { name: "Donation" })).toContainText("American Red Cross");
  const checks = page.getByRole("region", { name: "Is Jane right about these?" });
  await expect(checks).toContainText("MasterClass");
  await checks.getByRole("button", { name: "No, not for taxes" }).first().click();
  // Answered: it leaves the list (Duolingo, the other course, is still asked about).
  await expect(checks).not.toContainText("MasterClass");
  await expect(checks).toContainText("Duolingo");
  expect(await axe(page)).toEqual([]);

  await page.getByLabel(/Find a charge from 2026/).fill("Shell");
  await page.getByRole("button", { name: "Find" }).click();
  const search = page.getByRole("region", { name: "Tag something else" });
  const first = search.getByRole("listitem").first();
  await first.getByRole("combobox").selectOption("work");
  await first.getByRole("button", { name: "Save" }).click();
  await expect(first.getByRole("status")).toHaveText("Saved.");

  await page.goto("/tax-pack");
  await expect(page.getByRole("region", { name: "Summary" })).toContainText("Work expenses");
  await expect(page.getByRole("region", { name: "Tax forms to expect" })).toContainText(
    "W-2 from ACME CORP PAYROLL",
  );
  expect(await axe(page)).toEqual([]);
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { landInChat } from "./chat-page";

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
    // The side chat is the chat page itself, checked on its own (/chat).
    .exclude('iframe[title="Chat with Jane"]')
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
  await landInChat(page, 60_000);

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
  // Spec step 141: what the Taxes area may do by itself, as Settings has it.
  const byHerself = page.getByRole("region", { name: "What Jane does by herself" });
  await expect(byHerself).toContainText("Taxes is set to");
  await expect(byHerself).toContainText("Nothing is ever filed or signed without your tap.");
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
  // Spec step 267: the business page is one click from /taxes.
  await expect(
    page.getByRole("region", { name: "Business taxes" }).getByRole("link", {
      name: "See my business taxes",
    }),
  ).toHaveAttribute("href", "/taxes/business");

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
  await landInChat(page, 60_000);

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

// Spec step 165: a move saved on the profile splits the state estimate, each state citing
// its tax agency, and both states are in the tax-time pack.
test("state taxes: a mid-year move splits the estimate, each state with its source", async ({
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
  await landInChat(page, 60_000);

  await page.goto("/taxes/profile#states");
  const where = page.locator("#states");
  await expect(where.getByRole("heading", { name: "Where you lived and worked" })).toBeVisible();
  await where.getByLabel("Moved on").fill("2026-07-01");
  await where.locator("select[name=movedFrom]").selectOption("CA");
  await where.locator("select[name=movedTo]").selectOption("NY");
  await where.getByRole("button", { name: "Save where I lived" }).click();
  await expect(where.getByRole("status")).toHaveText("Saved. Your state estimate uses it now.");
  expect(await axe(page)).toEqual([]);

  await page.goto("/taxes");
  const estimate = page.getByRole("region", { name: "Your 2026 estimate" });
  await expect(estimate.getByText(/^California and New York: /)).toBeVisible();
  await estimate.getByText("How Jane worked it out").click();
  await expect(
    estimate.getByRole("link", { name: "California Franchise Tax Board" }),
  ).toHaveAttribute("href", "https://www.ftb.ca.gov");
  await expect(
    estimate.getByRole("link", { name: "New York State Department of Taxation and Finance" }),
  ).toHaveAttribute("href", "https://www.tax.ny.gov");
  await expect(
    estimate.getByText(/^California: lived there Jan 1, 2026 to Jun 30, 2026/),
  ).toBeVisible();
  expect(await axe(page)).toEqual([]);

  await page.goto("/tax-pack?year=2026");
  const states = page.getByRole("region", { name: "States you lived or worked in" });
  await expect(states.getByRole("link", { name: "California Franchise Tax Board" })).toBeVisible();
  await expect(states.getByText("Jan 1, 2026 to Jun 30, 2026")).toBeVisible();
});

// Spec step 167: the year-round tax plan, each move by its deadline, one tap to put an open
// one on the deadlines.
test("the tax plan: moves by deadline, and one on the deadlines with a tap", async ({
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
  await landInChat(page, 60_000);

  await page.goto("/taxes#plan");
  const plan = page.getByRole("region", { name: /tax plan$/ });
  await expect(plan.getByRole("heading", { name: "File your return" })).toBeVisible();
  const add = plan.getByRole("button", { name: /^Add to my deadlines: / }).first();
  await expect(add).toBeVisible();
  await add.click();
  await expect(plan.getByText("On your deadlines.").first()).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

// Spec step 169: family details on the profile feed the family tax choices.
test("family details: saved on the profile, and the choices on /taxes", async ({
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
  await landInChat(page, 60_000);

  await page.goto("/taxes/profile#family");
  const form = page.locator("#family");
  await form.locator("input[name=childAge0]").fill("4");
  await form.getByRole("button", { name: "Save family details" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved. Your family tax choices use it now.");
  expect(await axe(page)).toEqual([]);

  // Spec step 170: the demo bank's home loan, each figure linked to where it came from.
  await page.goto("/taxes#home");
  const home = page.getByRole("region", { name: "Your home" });
  await expect(home.getByRole("link", { name: /^Demo Home Loan/ })).toHaveAttribute(
    "href",
    "/loans",
  );
  await expect(home.getByText(/^State and local taxes: /)).toBeVisible();

  await page.goto("/taxes#family");
  const family = page.getByRole("region", { name: "Family tax choices" });
  await expect(family.getByRole("heading", { name: "Claiming your children" })).toBeVisible();
  await expect(family.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("a sample draft return to check, for someone with no draft of their own", async ({
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
  await landInChat(page, 60_000);

  // Spec step 272, reached without a file: the stand-in's sample draft, read for the person.
  await page.goto("/taxes/draft");
  await page.getByRole("button", { name: "Check a sample draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Sample draft return.pdf: check what Jane read" }),
  ).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("retirement income, inherited money and disasters each have a page from /taxes", async ({
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
  await landInChat(page, 60_000);

  // Spec steps 271, 268 and 270: each reached from /taxes, with the chat's own lines.
  for (const [link, heading, section] of [
    ["See my retirement taxes", "Taxes on retirement income", /^Social Security: /],
    ["See inherited money and gifts", "Inherited money and gifts", /new cost basis/],
    ["See disaster relief", "Disasters and losses", /county|County/],
  ] as const) {
    await page.goto("/taxes");
    await page.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(section).first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
  }
});

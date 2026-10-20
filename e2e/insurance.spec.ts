import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Insurance (spec step 102): a person says they rent, sees the missing renters cover, adds
// their policy and the gap goes.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("a renter adds their renters policy and the gap goes", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/insurance");
  await expect(page.getByRole("heading", { name: "Insurance", level: 1 })).toBeVisible();
  await page.getByLabel("Your home").selectOption("rent");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("No renters insurance on file")).toBeVisible();

  await page.getByRole("link", { name: "I have this: add it" }).click();
  const add = page.locator("#add");
  await expect(add.getByLabel("What it insures")).toHaveValue("renters");
  await add.getByLabel("Insurance company").fill("Lemonade");
  await add.getByLabel("Price ($)").fill("12");
  await add.getByLabel("Paid").selectOption("monthly");
  await add.getByLabel("Your belongings ($)").fill("30000");
  await add.getByRole("button", { name: "Add it" }).click();

  await expect(page.getByText("Added to your insurance.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lemonade renters insurance" })).toBeVisible();
  await expect(page.getByText("Your belongings: $30,000.00")).toBeVisible();
  await expect(page.getByText("No renters insurance on file")).toHaveCount(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a demo-bank person sees the sample policy, like-for-like quotes and Jane's pick (steps 102–104)", async ({
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

  await page.goto("/insurance");
  await expect(page.getByRole("heading", { name: "GEICO car insurance" })).toBeVisible();
  // The demo bank has a mortgage and no home policy: a gap, with demo advice, labelled.
  await expect(page.getByText("No home insurance on file")).toBeVisible();
  await expect(
    page.getByText("Demo advice: sample data, not financial advice").first(),
  ).toBeVisible();
  // Spec step 152: the demo card's phone protection, with its limits, makes Asurion a
  // duplicate, cancelled through the usual card.
  const cards = page.getByRole("region", { name: "Cover through your cards" });
  await expect(cards.getByText(/Up to \$800\.00 a claim, Deductible \$50\.00/)).toBeVisible();
  await expect(
    cards.getByText(/You pay Asurion \$204\.00 a year for cover your Demo Credit Card/),
  ).toBeVisible();
  await expect(cards.getByRole("link", { name: "Cancel it" })).toHaveAttribute(
    "href",
    /^\/report\//,
  );

  // Without a policy, the quotes page sends you to pick one instead of saying it's gone.
  await page.goto("/insurance/quotes");
  await expect(page).toHaveURL("/insurance");

  await page.getByRole("link", { name: "Compare quotes" }).click();
  await expect(page.getByText("Sample quotes from Jane's demo carrier catalog")).toBeVisible();
  // The policy renews in 40 days, so Jane shopped it by herself when the bank linked
  // (spec step 104): her pick, why, labelled as demo advice.
  const pick = page.getByRole("region", { name: /Jane's pick/ });
  await expect(pick.getByRole("heading")).toHaveText("Jane's pick: Lighthouse Insurance (demo)");
  await expect(pick.getByText("$408.00 a year less for the same cover")).toBeVisible();
  await expect(pick.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  const lighthouse = page.getByRole("listitem").filter({ hasText: "Lighthouse Insurance (demo)" });
  await expect(lighthouse.getByText("Same cover and deductible as your policy.")).toBeVisible();
  await expect(
    lighthouse.getByText("$1,296.00 a year, $408.00 less than you pay now."),
  ).toBeVisible();

  // Spec step 106: Jane checked the cover by herself when the bank linked.
  await page.goto("/insurance/checkup");
  await expect(page.getByRole("heading", { name: "Coverage checkup", level: 1 })).toBeVisible();
  await expect(page.getByText(/Raise the injury cover on your GEICO car insurance/)).toBeVisible();
  await expect(page.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a demo-bank person says yes to Jane's pick (step 104)", async ({
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
  await page.goto("/insurance");
  await page.getByRole("link", { name: "Compare quotes" }).click();
  await page.getByRole("button", { name: "Yes, switch" }).click();
  await expect(page).toHaveURL("/actions");
});

test("a person starts a claim tracker and ticks off a step (step 107)", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/insurance/claims");
  await expect(page.getByRole("heading", { name: "Claims", level: 1 })).toBeVisible();
  await page.getByLabel("It's on").selectOption("kind:auto");
  await page.getByLabel("What happened").selectOption("accident");
  await page.getByRole("button", { name: "Start the tracker" }).click();
  await expect(page.getByRole("heading", { name: /^A car accident,/ })).toBeVisible();
  await expect(page.getByText("0 of 6 steps done")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("1 of 6 steps done")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a policy document is read for the person to check and confirm (step 151)", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  // No Claude key here: the person types the facts Claude would have read.
  await page.goto("/documents");
  await page.getByLabel("What is it?").selectOption("insurance_policy");
  await page.getByLabel("File (PDF or a photo)").setInputFiles({
    name: "declarations.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n%%EOF\n"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/Fill in the key facts below/)).toBeVisible();
  await page.getByLabel("Insurance company").fill("GEICO");
  await page.getByLabel("Type of policy").selectOption("auto");
  await page.getByRole("button", { name: "Save facts" }).click();
  await expect(page.getByLabel("Insurance company")).toHaveValue("GEICO");

  await page.goto("/insurance");
  await expect(page.getByRole("heading", { name: "Read from your documents" })).toBeVisible();
  await page.getByRole("link", { name: "Check and confirm" }).click();
  await expect(page.getByRole("heading", { name: "Check what Jane read", level: 1 })).toBeVisible();
  await expect(page.getByText("As you typed it.").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Deductible ($)" }).fill("500");
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText("Confirmed. It's on your insurance now.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "GEICO car insurance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Read from your documents" })).toHaveCount(0);
});

test("a demo-bank person sizes, applies for and buys life cover, a tap at a time (step 153)", async ({
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

  await page.goto("/insurance/life");
  await page.getByLabel("How many people depend on your income?").selectOption("2");
  await page.getByRole("button", { name: "Work it out" }).click();
  const need = page.getByRole("region", { name: /for 20 years|for 25 years|for 30 years/ });
  await expect(need.getByText(/10 years of your pay/)).toBeVisible();
  await expect(need.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  await page.getByRole("button", { name: "Apply" }).first().click();
  for (let i = 1; i <= 5; i += 1) {
    await expect(page.getByText(new RegExp(`^Question ${i} of 5:`))).toBeVisible();
    await page.getByRole("button", { name: "No", exact: true }).click();
  }
  await page.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByText(/their best rate\. Buy it\?/)).toBeVisible();
  await page.getByRole("button", { name: "Buy it" }).click();
  await expect(page.getByText("Added to your insurance.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /life insurance/ }).first()).toBeVisible();
});

test("a move gets its insurance changes ready, made on one tap (step 154)", async ({
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

  await page.goto("/life-events");
  await page.getByRole("button", { name: "Start the moving checklist" }).click();
  await expect(page.getByText(/0 of/).first()).toBeVisible();

  await page.goto("/insurance");
  const changes = page.getByRole("region", { name: "After life events" });
  await expect(
    changes.getByText("You're moving. Here's what I've got ready for your insurance:"),
  ).toBeVisible();
  await expect(
    changes.getByText("Update the address on your GEICO car policy (the price stays the same)"),
  ).toBeVisible();
  await changes.getByRole("button", { name: "Make the changes" }).click();
  await expect(page.getByText("Done. Your insurance is up to date.")).toBeVisible();
  await expect(page.getByRole("region", { name: "After life events" })).toHaveCount(0);
});

test("Jane files a small claim only after the person checks it (step 155)", async ({
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

  await page.goto("/insurance/claims");
  await page.getByLabel("It's on").selectOption({ label: "GEICO car insurance" });
  await page.getByRole("combobox", { name: "What happened" }).selectOption("accident");
  await page.getByRole("button", { name: "Start the tracker" }).click();
  await expect(page.getByText("Jane can file this claim for you.")).toBeVisible();
  await page.getByLabel("How much it cost ($)").fill("900");
  await page
    .getByRole("textbox", { name: "What happened" })
    .fill("Backed into a pole in a car park; the bumper is dented.");
  await page.getByRole("button", { name: "Write it up" }).click();

  // The draft, before anything goes to the insurer.
  await expect(
    page.getByText("Here's the claim I'd file with GEICO. Nothing goes until you tap File it."),
  ).toBeVisible();
  await expect(page.getByText("Claiming: $900.00")).toBeVisible();
  await page.getByRole("button", { name: "File it" }).click();
  await expect(
    page.getByText(/^Filed by Jane: GEICO has your claim, number DEMO-CLM-/),
  ).toBeVisible();
});

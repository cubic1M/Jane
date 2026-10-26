import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { landInChat } from "./chat-page";

// Insurance (spec step 102): a person says they rent, sees the missing renters cover, adds
// their policy and the gap goes. The page is the area tree (docs/design/area-pages.md): each
// thing is opened from its branch, and its detail opens below the tree.

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
  await page.getByText("Your household details").click();
  await page.getByLabel("Your home").selectOption("rent");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Jane checks your cover against it.")).toBeVisible();
  // The gap is urgent, so it's one of the chips above the tree too.
  await expect(
    page
      .getByRole("group", { name: "What matters now" })
      .getByRole("button", { name: /Renters insurance/ }),
  ).toBeVisible();
  await pickItem(page, "Insurance", "Cover that looks missing", "Renters insurance");
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
  await pickItem(page, "Insurance", "Your policies", "Lemonade renters");
  await expect(page.getByRole("heading", { name: "Lemonade renters insurance" })).toBeVisible();
  await expect(page.getByText("Your belongings: $30,000.00")).toBeVisible();
  await expect(page.getByText("No renters insurance on file")).toHaveCount(0);
  await expect(
    page.getByRole("tree", { name: "Insurance" }).getByText("Cover that looks missing"),
  ).toHaveCount(0);
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
  await landInChat(page, 60_000);
  // The chat opens once the first brief is in; Jane shops the insurance in the work after it.
  await waitForFullScan(userId!);

  await page.goto("/insurance");
  await pickItem(page, "Insurance", "Your policies", "GEICO car");
  await expect(page.getByRole("heading", { name: "GEICO car insurance" })).toBeVisible();
  // The demo bank has a mortgage and no home policy: a gap, with demo advice, labelled.
  const missing = await pickItem(page, "Insurance", "Cover that looks missing", "Home insurance");
  await expect(missing.getByText("No home insurance on file")).toBeVisible();
  await expect(missing.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // Spec step 152: the demo card's phone protection, with its limits, makes Asurion a
  // duplicate, cancelled through the usual card.
  const card = await pickItem(page, "Insurance", "Cover through your cards", "Demo Credit Card");
  await expect(card.getByText(/Up to \$800\.00 a claim, Deductible \$50\.00/)).toBeVisible();
  const twice = await pickItem(page, "Insurance", "Cover through your cards", "Paying twice");
  await expect(
    twice.getByText(/You pay Asurion \$204\.00 a year for cover your Demo Credit Card/),
  ).toBeVisible();
  await expect(twice.getByRole("link", { name: "Cancel it" })).toHaveAttribute(
    "href",
    /^\/report\//,
  );

  // Without a policy, the quotes page sends you to pick one instead of saying it's gone.
  await page.goto("/insurance/quotes");
  await expect(page).toHaveURL("/insurance");

  await pickItem(page, "Insurance", "Your policies", "GEICO car");
  await page.getByRole("link", { name: "Compare quotes" }).click();
  await expect(page.getByText("Sample quotes from Jane's demo carrier catalog")).toBeVisible();
  // The policy renews in 40 days, so Jane shopped it on its own when the bank linked
  // (spec step 104): its pick, why, labelled as demo advice.
  // Its pick and the other cheaper quotes as comparison cards, Jane's tagged.
  const pick = page.getByRole("region", { name: "Jane's pick" });
  const janes = pick.locator("li[data-option-id]").filter({ hasText: "JANE'S PICK" });
  await expect(janes.getByRole("heading", { level: 4 })).toHaveText("Lighthouse Insurance (demo)");
  await expect(janes.locator('[data-row="saves"] dd')).toHaveText("$408.00");
  await expect(janes.locator('[data-row="cover"] dd')).toContainText("Same as now");
  await expect(pick.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // The full list of quotes below the cards.
  const lighthouse = page
    .locator("li:not([data-option-id])")
    .filter({ hasText: "Lighthouse Insurance (demo)" });
  await expect(lighthouse.getByText("Same cover and deductible as your policy.")).toBeVisible();
  await expect(
    lighthouse.getByText("$1,296.00 a year, $408.00 less than you pay now."),
  ).toBeVisible();

  // Spec step 106: Jane checked the cover on its own when the bank linked.
  await page.goto("/insurance/checkup");
  await expect(page.getByRole("heading", { name: "Coverage checkup", level: 1 })).toBeVisible();
  await expect(page.getByText(/Raise the injury cover on your GEICO car insurance/)).toBeVisible();
  // The page's own label (a pop-up card may carry the same words).
  await expect(page.locator("[data-demo-advice]").first()).toHaveText(
    "Demo advice: sample data, not financial advice",
  );
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
  await landInChat(page, 60_000);
  // The chat opens once the first brief is in; Jane shops the insurance in the work after it.
  await waitForFullScan(userId!);
  // Jane's pick is made by the first scan's work after the brief, which can finish a little
  // after the chat opens on a busy machine: look again until the pick is there.
  await expect(async () => {
    await page.goto("/insurance");
    await pickItem(page, "Insurance", "Your policies", "GEICO car");
    await page.getByRole("link", { name: "Compare quotes" }).click({ timeout: 10_000 });
    await expect(page.getByText("JANE'S PICK")).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  // Jane's pick and the other cheaper quotes side by side; choosing its pick starts the switch.
  const pick = page.locator("li[data-option-id]").filter({ hasText: "JANE'S PICK" });
  await pick.getByRole("button", { name: /^Choose / }).click();
  await expect(page.getByRole("status").filter({ hasText: "Chosen:" })).toContainText(
    "I'm switching you now",
    { timeout: 30_000 },
  );
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
  const read = await pickItem(page, "Insurance", "Read from your documents", "first-open");
  await read.getByRole("link", { name: "Check and confirm" }).click();
  await expect(page.getByRole("heading", { name: "Check what Jane read", level: 1 })).toBeVisible();
  await expect(page.getByText("As you typed it.").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Deductible ($)" }).fill("500");
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText("Confirmed. It's on your insurance now.")).toBeVisible();
  await pickItem(page, "Insurance", "Your policies", "GEICO car");
  await expect(page.getByRole("heading", { name: "GEICO car insurance" })).toBeVisible();
  await expect(
    page.getByRole("tree", { name: "Insurance" }).getByText("Read from your documents"),
  ).toHaveCount(0);
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
  await landInChat(page, 60_000);

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
  await pickItem(page, "Insurance", "Your policies", / life\b/);
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
  await landInChat(page, 60_000);

  await page.goto("/life-events");
  await page.getByRole("button", { name: "Start the moving checklist" }).click();
  await expect(page.getByText(/0 of/).first()).toBeVisible();

  await page.goto("/insurance");
  // Each event's changes are their own item: the move's, and the demo bank's car.
  const changes = await pickItem(page, "Insurance", "After life events", "Your move");
  await expect(
    changes.getByText("You're moving. Here's what I've got ready for your insurance:"),
  ).toBeVisible();
  await expect(
    changes.getByText("Update the address on your GEICO car policy (the price stays the same)"),
  ).toBeVisible();
  await changes.getByRole("button", { name: "Make the changes" }).click();
  await expect(page.getByText("Done. Your insurance is up to date.")).toBeVisible();
  const car = await pickItem(page, "Insurance", "After life events", "A new car");
  await car.getByRole("button", { name: "Make the changes" }).click();
  await expect(page.getByText("Done. Your insurance is up to date.")).toBeVisible();
  await expect(
    page.getByRole("tree", { name: "Insurance" }).getByText("After life events"),
  ).toHaveCount(0);
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
  await landInChat(page, 60_000);

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

test("a demo-bank person pays less for the same cover with one tap (step 196)", async ({
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

  await page.goto("/insurance");
  // A higher deductible lowers the cover, so it says what a claim would cost.
  const deductible = await pickItem(
    page,
    "Insurance",
    "Pay less for the same cover",
    "Raise the deductible",
  );
  await expect(
    deductible.getByText(/if you claim, you pay \$1,000\.00 more yourself/),
  ).toBeVisible();
  const savings = await pickItem(
    page,
    "Insurance",
    "Pay less for the same cover",
    "Turn on autopay",
  );
  await expect(
    savings.getByText(/Turn on autopay for your GEICO car policy: about \$51\.12 a year less/),
  ).toBeVisible();
  await savings.getByRole("button", { name: "Do it" }).click();
  await expect(
    page.getByText("Done. Your policy is updated and your insurer confirmed it."),
  ).toBeVisible();
  await expect(
    page.getByRole("tree", { name: "Insurance" }).getByText("Turn on autopay"),
  ).toHaveCount(0);
});

test("a demo-bank person answers a question about how they live, and a yes opens a gap (step 197)", async ({
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

  await page.goto("/insurance");
  const uber = await pickItem(
    page,
    "Insurance",
    "Questions about how you live",
    "Driving for pay?",
  );
  await expect(uber.getByText(/I saw \$412\.00 come in from Uber Driver/).first()).toBeVisible();
  await uber.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("Thanks. Jane has noted it.")).toBeVisible();
  await expect(
    page.getByRole("tree", { name: "Insurance" }).getByText("Driving for pay?"),
  ).toHaveCount(0);
  await pickItem(page, "Insurance", "Cover that looks missing", "Cover while driving for pay");
  await expect(
    page.getByRole("heading", {
      name: "Your car policy may not cover you while you drive for pay",
    }),
  ).toBeVisible();

  // A no is remembered: the boat question never comes back.
  const boat = await pickItem(page, "Insurance", "Questions about how you live", "A boat?");
  await boat.getByRole("button", { name: "No" }).click();
  await page.goto("/insurance");
  await expect(page.getByRole("tree", { name: "Insurance" }).getByText("A boat?")).toHaveCount(0);
  await expect(page.getByText("Do you have a boat?")).toHaveCount(0);
});

test("a person lists their household and sees who is covered by what (step 198)", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/insurance");
  const you = await pickItem(page, "Insurance", "Your household's cover", "You");
  await expect(you.getByText("You: no policy on file")).toBeVisible();
  const household = await pickItem(
    page,
    "Insurance",
    "Your household's cover",
    "Add someone or share",
  );
  await household.getByLabel("Name").fill("Sam");
  await household.getByLabel("Who they are to you").selectOption("child");
  await household.getByLabel("Age").fill("16");
  await household.getByLabel("Drives").check();
  await household.getByRole("button", { name: "Add them" }).click();
  const sam = await pickItem(page, "Insurance", "Your household's cover", "Sam");
  await expect(sam.getByText(/^Sam.*no policy on file/)).toBeVisible();
  // No car policy covers a 16-year-old driver: a gap, with the usual "I don't need it".
  await pickItem(page, "Insurance", "Cover that looks missing", "A driver not on a policy");
  await expect(page.getByRole("heading", { name: "Sam isn't on a car policy" })).toBeVisible();
});

test("a demo-bank person sees their health plan's year and a dispute card (step 200)", async ({
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

  await page.goto("/insurance");
  const year = await pickItem(
    page,
    "Insurance",
    "Your health plan this year",
    "Deductible this year",
  );
  await expect(year.getByText(/of your \$500\.00 deductible/)).toBeVisible();
  await expect(year.getByText(/left in your FSA.*Dec 31/)).toBeVisible();
  await expect(year.getByText(/BAYVIEW IMAGING CENTER billed/)).toBeVisible();
});

test("a demo-bank person goes from a gap to a picked option, and it reaches the team (step 279)", async ({
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
  await waitForFullScan(userId!);
  await page.goto("/insurance");
  await pickItem(page, "Insurance", "Your perfect coverage", "first-open");
  await page.getByRole("link", { name: "See options" }).click();
  const card = page.getByTestId("option-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  await expect(card.getByText("JANE'S PICK")).toBeVisible();
  await card
    .getByRole("button", { name: /^Choose / })
    .first()
    .click();
  await expect(card.getByRole("status")).toContainText("My team will", { timeout: 30_000 });
});

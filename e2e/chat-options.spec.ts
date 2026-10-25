import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser, signedInUser, waitForFullScan } from "./db";
import { CHAT, landInChat } from "./chat-page";

// Options of one choice in the chat (insurance cover, loan offers): Jane's answer carries the
// lane's pick-one card (refs.options), which floats over the chat as the pick card. A pick is
// answered on screen at once, the next card (the day's suggestions) is there within 100 ms,
// and the pick reaches the team through the insurance picker behind it.
//
// Claude writes those answers, and there's no key in tests, so the answer is posted here as
// the app stores it, with the person's real options read from the insurance page (a pick is
// priced again on the server, so the ids must be real).

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const DOLLARS = /\$([\d,]+(?:\.\d\d)?)/;

test("a pick on the options card is instant, and the next card follows within 100 ms", async ({
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
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);

  // The person's own options for a cover they're short of, as the insurance page shows them.
  await page.goto("/insurance");
  await pickItem(page, "Insurance", "Your perfect coverage", "first-open");
  await page.getByRole("link", { name: "See options" }).click();
  const shown = page.getByTestId("option-card");
  await expect(shown).toBeVisible();
  const compared = shown.getByTestId("comparison");
  const title = ((await compared.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
  const need = (await compared.getAttribute("data-topic")) ?? "";
  const policy = (await compared.getAttribute("data-policy")) ?? "";
  // A card saved as older chat messages were (no comparison numbers): the floating pick card.
  const rows = await compared.locator("li[data-option-id]").evaluateAll((items) =>
    items.map((li) => ({
      id: li.getAttribute("data-option-id") ?? "",
      name: li.querySelector("h4")?.textContent ?? "",
      year: li.querySelector('[data-row="year"] dd')?.textContent ?? "",
      isPick: (li.textContent ?? "").includes("JANE'S PICK"),
      why: li.querySelector("[id^=why-] p")?.textContent ?? "",
    })),
  );
  // Her pick first, as the chat's card has it.
  rows.sort((a, b) => Number(b.isPick) - Number(a.isPick));
  const options = rows.map((r) => ({
    id: r.id,
    label: r.name,
    headline: `${r.name}, ${r.year} a year`,
    priceCents: Math.round(Number((DOLLARS.exec(r.year)?.[1] ?? "0").replace(/,/g, "")) * 100),
    pricePeriod: "year",
    facts: [],
    whyThisOne: r.why,
    isPick: r.isPick,
    details: [],
  }));

  // Jane's answer, as the insurance_needs tool leaves it.
  const messageId = await addJaneMessage(user.userId, {
    kind: "reply",
    body: "You're short of cover. My pick is the first option; the others are on the card.",
    refs: {
      advice: true,
      options: {
        kind: "insurance",
        title,
        topic: need,
        newCover: !policy,
        advice: true,
        options,
        ...(policy ? { policyId: policy } : {}),
      },
    },
    actions: [
      { id: "option.pick", label: "Pick this one", kind: "primary" },
      { id: "option.later", label: "Later", kind: "secondary" },
    ],
  });

  await page.goto(CHAT);
  const pickCard = page.getByRole("region", { name: title });
  await expect(pickCard).toBeVisible();
  expect(await pickCard.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  const showing = pickCard.locator('[data-card-state="showing"]');
  await expect(pickCard.locator("p[aria-live]")).toHaveText(`1 of ${options.length}`);
  // Her pick first, labelled, the headline short with its price as the one figure.
  await expect(showing.getByText("Jane's pick")).toBeVisible();
  const headline = (await showing.getByRole("heading", { level: 3 }).textContent()) ?? "";
  expect(headline).toMatch(/\/yr$/);
  expect((headline.match(/\$[\d,.]+/g) ?? []).length).toBe(1);
  expect(headline.trim().split(/\s+/).length).toBeLessThanOrEqual(9);
  // The reasoning is behind More details, with the demo advice label.
  await showing.getByRole("button", { name: "More details" }).click();
  await expect(showing.getByText("Demo advice: sample data, not financial advice")).toBeVisible();
  // Its buttons are the card's: none under the message itself.
  const answer = page.locator(`li[id="${messageId}"]`);
  await expect(answer.getByRole("button", { name: /Pick this one/ })).toHaveCount(0);

  // The pick: the card goes and the day's suggestions are there within 100 ms.
  const suggestions = page.getByRole("region", { name: "Suggestions for you" });
  const started = Date.now();
  await showing.getByRole("button", { name: "Pick this one" }).click();
  await expect(suggestions.locator('[data-card-state="showing"]')).toBeVisible({ timeout: 100 });
  await expect(pickCard).toHaveCount(0, { timeout: 100 });
  expect(Date.now() - started).toBeLessThan(1_000);

  // Behind it, the pick went to the team, and the chat's history shows what was chosen.
  await expect(answer.getByText("You chose:")).toBeVisible({ timeout: 30_000 });
  // The options stay, greyed, the chosen one marked, with Revert (founder, 2026-10-25).
  const choices = answer.locator("[data-chosen-choices] button");
  await expect(choices).toHaveCount(options.length);
  await expect(answer.locator('[data-chosen-choices] [aria-pressed="true"]')).toContainText(
    options[0].label,
  );
  for (const choice of await choices.all()) await expect(choice).toBeDisabled();
  await expect(answer.getByRole("button", { name: /Revert/ })).toBeVisible();
  await expect(answer.getByText(/My team will/)).toBeVisible();

  // Reloaded, the card stays gone.
  await page.reload();
  await expect(page.getByRole("region", { name: title })).toHaveCount(0);
});

// Gap audit: switching to cheaper insurance is a pick-one card too, Jane's pick first and the
// other cheaper quotes after; a pick starts the switch. Its card carries the comparison's
// numbers, so on a phone it's the comparison sheet (founder, 2026-10-24): a stack to swipe, a
// Compare toggle that lines the options up, and one tap to choose, shown at once.
test("cheaper car insurance comes as comparison cards, and a pick starts the switch", async ({
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
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);
  await page.reload();

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("find me cheaper car insurance");
  await ask.press("Enter");
  const sheet = page.getByRole("dialog", { name: /^Switch your .+ car insurance$/ });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const cards = sheet.locator("li[data-option-id]");
  const first = cards.first();
  await expect(first.getByText("JANE'S PICK")).toBeVisible();
  await expect(first.getByText("/mo")).toBeVisible();
  const carrier = ((await first.getByRole("heading", { level: 4 }).textContent()) ?? "").trim();
  // On a phone: a stack to swipe through, the page itself not wider than the screen.
  if ((await cards.count()) > 1) {
    const list = sheet.getByRole("list").first();
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  // Compare lines them up as a table, and back.
  await sheet.getByRole("button", { name: "▥ Compare" }).click();
  await expect(sheet.getByTestId("compare-table")).toBeVisible();
  await sheet.getByRole("button", { name: "▤ Cards" }).click();

  const started = Date.now();
  await first.getByRole("button", { name: `Choose ${carrier}` }).click();
  await expect(first).toHaveAttribute("data-chosen", "", { timeout: 100 });
  await expect(sheet.getByRole("status")).toContainText(`Chosen: ${carrier}`, { timeout: 100 });
  expect(Date.now() - started).toBeLessThan(1_000);
  // Behind it, the switch started, and the chat's history says what was chosen.
  await expect(sheet.getByRole("status")).toContainText("I'm switching you now", {
    timeout: 30_000,
  });
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
  const answer = page.getByRole("listitem").filter({ hasText: "You chose:" }).last();
  await expect(answer).toContainText(carrier, { timeout: 30_000 });
});

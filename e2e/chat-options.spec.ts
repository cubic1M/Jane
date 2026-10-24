import { expect, test } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser, signedInUser, waitForFullScan } from "./db";

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
    await expect(page).toHaveURL("/chat", { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);

  // The person's own options for a cover they're short of, as the insurance page shows them.
  await page.goto("/insurance");
  await pickItem(page, "Insurance", "Your perfect coverage", "first-open");
  await page.getByRole("link", { name: "See options" }).click();
  const shown = page.getByTestId("option-card");
  await expect(shown).toBeVisible();
  const title = ((await shown.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
  const rows = await shown.locator("li:has(form)").evaluateAll((items) =>
    items.map((li) => {
      const value = (name: string) =>
        (li.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? "";
      const lines = [...li.querySelectorAll(":scope > p")].map((p) => p.textContent ?? "");
      return {
        need: value("need"),
        policy: value("policy"),
        id: value("option"),
        headline: lines[0].replace(" · Jane's pick", ""),
        isPick: lines[0].includes("Jane's pick"),
        why: lines[1] ?? "",
      };
    }),
  );
  expect(rows.length).toBeGreaterThanOrEqual(2);
  const options = rows.map((r) => ({
    id: r.id,
    label: r.headline.split(",")[0],
    headline: r.headline,
    priceCents: Math.round(Number((DOLLARS.exec(r.headline)?.[1] ?? "0").replace(/,/g, "")) * 100),
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
        topic: rows[0].need,
        newCover: !rows[0].policy,
        advice: true,
        options,
        ...(rows[0].policy ? { policyId: rows[0].policy } : {}),
      },
    },
    actions: [
      { id: "option.pick", label: "Pick this one", kind: "primary" },
      { id: "option.later", label: "Later", kind: "secondary" },
    ],
  });

  await page.goto("/chat");
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
  await expect(answer.getByText(options[0].label)).toBeVisible();
  await expect(answer.getByText(/My team will/)).toBeVisible();

  // Reloaded, the card stays gone.
  await page.reload();
  await expect(page.getByRole("region", { name: title })).toHaveCount(0);
});

// Gap audit: switching to cheaper insurance is a pick-one card too, Jane's pick first and the
// other cheaper quotes after; a pick starts the switch.
test("cheaper car insurance comes as a pick-one card, and a pick starts the switch", async ({
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
    await expect(page).toHaveURL("/chat", { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await waitForFullScan(user.userId);
  await page.reload();

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("find me cheaper car insurance");
  await ask.press("Enter");
  const card = page.getByRole("region", { name: /^Switch your .+ car insurance$/ });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const showing = card.locator('[data-card-state="showing"]');
  await expect(showing.getByText("Jane's pick")).toBeVisible();
  const headline = (await showing.getByRole("heading", { level: 3 }).textContent()) ?? "";
  expect(headline).toMatch(/, \$[\d,]+\/yr$/);
  const carrier = headline.split(",")[0];

  const started = Date.now();
  await showing.getByRole("button", { name: "Pick this one" }).click();
  await expect(card).toHaveCount(0, { timeout: 100 });
  expect(Date.now() - started).toBeLessThan(1_000);
  // Behind it, the switch started, and the chat's history says what was chosen.
  const answer = page.getByRole("listitem").filter({ hasText: "You chose:" }).last();
  await expect(answer).toContainText(carrier, { timeout: 30_000 });
  await expect(answer).toContainText("I'm switching you now");
});

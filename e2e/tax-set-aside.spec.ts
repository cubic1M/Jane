import { expect, test } from "@playwright/test";
import { walkToCard } from "./card-walk";
import { CHAT } from "./chat-page";
import { E2E_DATABASE_URL, addFreelancer, deleteUser, signedInUser, treatAsDemoBank } from "./db";

// The tax left to cover, on a real account: a fact, not advice; the calculation line by line; and a
// correction that moves it, on Home's Safe to spend too, and can be undone.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const money = (text: string | null) => Number((text ?? "").replace(/[^0-9.]/g, ""));

test("the calculation is shown, says no advice, and takes a correction", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await addFreelancer(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);

  await page.goto("/taxes?focus=estimate:set-aside");
  const section = page.locator("#set-aside");
  await expect(section.getByRole("heading", { name: "Tax not yet paid" })).toBeVisible();
  await expect(section).toContainText("% sure");
  await expect(section).toContainText("Jane can't see any money kept apart");
  await expect(section).toContainText("not tax advice");
  await expect(section).not.toContainText(/set aside/i);

  await section.getByText("Show the calculation").click();
  const row = (label: string) => section.getByRole("row").filter({ hasText: label });
  const left = () => row("Not yet withheld or paid").getByRole("cell").last().innerText();
  const before = money(await left());
  expect(before).toBeGreaterThan(0);
  await expect(row("Income Jane saw so far")).toContainText("Seen");
  await expect(row("Standard deduction")).toContainText("Assumed");
  await row("Standard deduction").locator("summary").click();
  await expect(row("Standard deduction")).toContainText("check with a tax professional");

  // Home and the full working quote the same line.
  await page.goto("/home");
  await page
    .getByRole("button", { name: /why this number/i })
    .first()
    .click();
  await expect(page.locator("[data-safe-why]")).toContainText("Tax not yet withheld or paid");
  await expect(page.locator("[data-safe-why]")).toContainText("none kept apart");
  await page.goto("/figures/safe_to_spend");
  await expect(page.getByText("Tax not yet withheld or paid").first()).toBeVisible();

  // "That isn't income".
  await page.goto("/taxes?focus=estimate:set-aside");
  await section.getByText("Point something out").click();
  await section.getByRole("button", { name: /That isn.t income\s*:\s*AUNT ROSE/ }).click();
  await expect(section).toContainText("AUNT ROSE: not income");
  await section.getByText("Show the calculation").click();
  await expect.poll(async () => money(await left())).toBeLessThan(before);

  // It holds across a fresh load, and undoes.
  await page.reload();
  await expect(section).toContainText("AUNT ROSE: not income");
  await section.getByRole("button", { name: /Undo\s*:\s*AUNT ROSE/ }).click();
  await expect(section).not.toContainText("AUNT ROSE: not income");
  await section.getByText("Show the calculation").click();
  await expect.poll(async () => money(await left())).toBe(before);

  // "I paid this".
  await section.getByText("Point something out").click();
  await section.getByLabel("What should Jane know?").selectOption("paid_federal");
  await section.getByLabel("Amount").fill("1000");
  await section.getByRole("button", { name: "Work it out again" }).click();
  await expect(section).toContainText("A tax payment, $1,000.00");
});

test("it comes up unasked: the card has the figure and how sure Jane is", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.setTimeout(300_000);
  const user = await signedInUser("user");
  userId = user.userId;
  await addFreelancer(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  // The figure the calculation shows is the figure the card must say.
  await page.goto("/taxes?focus=estimate:set-aside");
  const line = await page
    .locator("#set-aside")
    .getByText(/^About \$[\d,]+ of your/)
    .innerText();
  const figure = /\$[\d,]+/.exec(line)?.[0];

  // Opening the chat runs Jane's first scan before it answers, which posts the card.
  await page.goto(CHAT);
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  const docked = !isMobile;
  const scope = docked
    ? page.getByRole("complementary", { name: "Chat with Jane" }).locator("[data-card-dock]")
    : page.locator('.floating-cards[data-floating-cards="queue"]');
  const card = await walkToCard(
    page,
    async () => {
      await page.goto("/home");
      if (isMobile) await page.locator('[data-card-state="folded"]').click({ timeout: 60_000 });
      return scope;
    },
    `Check tax not yet paid: about ${figure}`,
    { docked },
  );
  await expect(card).toContainText(/\d+% sure/);
  await expect(card).not.toContainText(/set aside/i);
});

test("demo advice says set aside, with its label", async ({ context, page, baseURL }) => {
  const user = await signedInUser("user");
  userId = user.userId;
  await addFreelancer(user.userId);
  await treatAsDemoBank(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.goto("/taxes?focus=estimate:set-aside");
  const section = page.locator("#set-aside");
  await expect(section.getByRole("heading", { name: "Tax to set aside" })).toBeVisible();
  await expect(section).toContainText("Demo advice: sample data, not financial advice");
});

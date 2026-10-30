import { expect, test, type Locator, type Page } from "@playwright/test";
import { walkToCard } from "./card-walk";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Every choice on a card is always shown (founder: "the suggestion cards have an issue where not
// all the choices are shown"): a decision with several long choices, in the dock above the chat
// on a computer and floating on a tablet or a phone, shut and opened, has every button in view
// inside the card and the screen, whole and clickable; one line when they fit, more when not.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(300_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const HEADLINE = "Choose how much I handle on my own.";
const LABELS = [
  "Handle the safe stuff",
  "Handle everything allowed",
  "Ask me first every time",
  // Its own snooze, in place of Not now.
  "Decide this next week",
];

async function everyChoiceShown(page: Page, card: Locator) {
  const view = page.viewportSize()!;
  // Settled: the card may still be growing to its width or height.
  let last = "";
  await expect
    .poll(async () => {
      const b = await card.boundingBox();
      const now = JSON.stringify(b && [b.x, b.y, b.width, b.height].map(Math.round));
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  const box = (await card.boundingBox())!;
  const buttons = card.locator("[data-card-actions] button");
  await expect(buttons).toHaveText(LABELS);
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const b = (await button.boundingBox())!;
    // Inside the card and the screen, and the whole label inside its button.
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(view.width + 1);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(view.height + 1);
    expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await button.click({ trial: true });
  }
}

test("every choice on a card is in view and clickable, shut and opened", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  userId = await demoPerson(context, page, baseURL);
  await addJaneMessage(userId, {
    kind: "decision",
    body: `${HEADLINE}\nI can do the safe things myself, or everything you allow, or ask first.`,
    refs: {},
    actions: [
      { id: "autopilot.safe", label: LABELS[0], kind: "primary" },
      { id: "autopilot.all", label: LABELS[1], kind: "secondary" },
      { id: "autopilot.ask", label: LABELS[2], kind: "secondary" },
      { id: "snooze", label: LABELS[3], kind: "secondary" },
    ],
  });

  const sizes = isMobile
    ? [{ width: 375, height: 812 }]
    : [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
      ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const docked = size.width >= 1024;
    const scope = docked
      ? page.getByRole("complementary", { name: "Chat with Jane" }).locator("[data-card-dock]")
      : page.locator('.floating-cards[data-floating-cards="queue"]');
    const card = await walkToCard(
      page,
      async () => {
        await page.goto("/home");
        if (size.width < 640) {
          await page.locator('[data-card-state="folded"]').click({ timeout: 60_000 });
        }
        return scope;
      },
      HEADLINE,
      { docked },
    );
    await test.step(`${size.width}px, shut`, () => everyChoiceShown(page, card));
    await card.getByRole("button", { name: "More details" }).click();
    await expect(card.locator('[id^="details-"]')).toBeVisible();
    await page.waitForTimeout(400);
    await test.step(`${size.width}px, opened`, () => everyChoiceShown(page, card));
  }
});

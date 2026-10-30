import { expect, test, type FrameLocator } from "@playwright/test";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Night debugger: on a phone, with the chat sheet open, Jane's card covered the newest answer.
// The chat went to its end once, before the sheet had opened and the card come in over it. It
// stays at the end as the sheet opens and grows and the card comes in, until the person scrolls
// up to read.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

const LAST = "Answer 7: that's the newest one.";

// Where the newest answer ends, and where what floats over the chat's end begins (the card, or
// the message box when there is no card), in the frame's own pixels.
const ends = (chat: FrameLocator) =>
  chat.locator("html").evaluate(() => {
    const items = document.querySelectorAll('ol[aria-label="Messages"] > li');
    const last = items[items.length - 1]?.getBoundingClientRect();
    const card = document.querySelector('[data-floating-cards] [data-card-state="showing"]');
    const cover = (card ?? document.querySelector("[data-chat-composer]"))!.getBoundingClientRect();
    return {
      lastTop: last?.top ?? -1,
      lastBottom: last?.bottom ?? -1,
      coverTop: cover.top,
      card: !!card,
    };
  });

test("on a phone, the chat sheet opens at its newest answer, clear of Jane's card", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's chat sheet");
  userId = await demoPerson(context, page, baseURL);
  for (let i = 0; i < 8; i += 1) {
    await addJaneMessage(userId, { kind: "user", body: `Question ${i}?`, refs: {}, actions: [] });
    await addJaneMessage(userId, {
      kind: "reply",
      body: i === 7 ? LAST : `Answer ${i}: ${"a few more words of the answer ".repeat(6)}`,
      refs: {},
      actions: [],
    });
  }

  await page.goto("/money");
  await page.locator("#jane-fab").click();
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(chat.getByText(LAST)).toBeAttached({ timeout: 60_000 });
  // Clear of the card (or the message box), and on screen.
  const clear = async () => {
    const e = await ends(chat);
    return e.lastBottom > 0 && e.lastBottom <= e.coverTop + 1;
  };
  await expect.poll(clear, { timeout: 15_000 }).toBe(true);
  expect((await ends(chat)).card).toBe(true);
  await page.waitForTimeout(1_500);
  expect(await clear()).toBe(true);

  // Grown to the whole screen: still at the end.
  await page.getByRole("button", { name: "Expand chat" }).click();
  await expect.poll(clear, { timeout: 10_000 }).toBe(true);

  // Scrolled up to read, it stays there when the sheet shrinks.
  await chat.locator("html").evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Shrink chat" }).click();
  await page.waitForTimeout(1_000);
  expect(await chat.locator("html").evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
});

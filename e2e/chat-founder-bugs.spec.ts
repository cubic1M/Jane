import { expect, type Page, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { CHAT, landInChat } from "./chat-page";

// Three things the founder saw in the chat (11-12), each as the person sees it:
// - the answer visibly reloads once it has finished writing;
// - the message box stays one line however much is typed;
// - a suggestion tapped on its card leaves a trace in the chat.
// beta-chat owns the fixes; these fail until each lands.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
  userId = undefined;
});

async function signedInChat(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
  await page.goto("/connect");
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible({
    timeout: 60_000,
  });
}

test("a finished answer stays on screen: it doesn't vanish and come back", async ({
  page,
  baseURL,
}) => {
  await signedInChat(page, baseURL);
  // Every frame, how much of Jane's newest answer is on screen: the words being written, then
  // the stored message. Once there are words, they must never go away.
  await page.evaluate(() => {
    const w = window as unknown as { __lengths: number[] };
    w.__lengths = [];
    const newest = () => {
      const draft = document.querySelector("[data-draft-answer]");
      if (draft?.textContent?.trim()) return draft.textContent.trim().length;
      const items = document.querySelectorAll('ol[aria-label="Messages"] > li');
      const last = items[items.length - 1];
      const text = last?.textContent ?? "";
      return /jane>/.test(text) ? text.trim().length : 0;
    };
    const tick = () => {
      w.__lengths.push(newest());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill("what is my safe to spend");
  await ask.press("Enter");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({
    timeout: 90_000,
  });
  // The chat's refresh after the answer has come and gone.
  await page.waitForLoadState("networkidle");
  const lengths = await page.evaluate(
    () => (window as unknown as { __lengths: number[] }).__lengths,
  );
  const firstWords = lengths.findIndex((n) => n > 0);
  expect(firstWords, "the answer never showed").toBeGreaterThanOrEqual(0);
  // Once words are on screen they only grow: a frame with less than most of what was already
  // shown is the answer gone, or written out again from the start.
  let most = 0;
  const reloads: number[] = [];
  for (const n of lengths.slice(firstWords)) {
    if (most > 20 && n < most * 0.8) reloads.push(n);
    most = Math.max(most, n);
  }
  expect(reloads.length, "frames where the finished answer went away or started over").toBe(0);
});

test("the message box grows with what's typed", async ({ page, baseURL }) => {
  await signedInChat(page, baseURL);
  const box = page.getByRole("textbox", { name: "Message Jane" });
  const before = (await box.boundingBox())!.height;
  await box.fill(
    "I moved to a new apartment last month and the rent went up, my car insurance renewed " +
      "higher, and I picked up a second job on weekends. What changed most in my spending, and " +
      "is there anything I'm paying for that I should look at again?",
  );
  const after = (await box.boundingBox())!.height;
  expect(after, "the box is as tall with three lines of text as with none").toBeGreaterThan(
    before * 1.5,
  );
  // Everything typed is in view, wrapped, not scrolled off to the side.
  const sideways = await box.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(sideways, "the text runs off the side of the box").toBe(false);
});

test("a suggestion answered on its card leaves nothing in the chat", async ({ page, baseURL }) => {
  await signedInChat(page, baseURL);
  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  const card = overlay.locator('[data-card-state="showing"]');
  await expect(card).toBeVisible({ timeout: 60_000 });
  const headline = ((await card.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
  expect(headline).not.toBe("");
  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  const before = await messages.allInnerTexts();

  const tapped = page.waitForResponse((r) => r.request().method() === "POST", { timeout: 30_000 });
  await card.getByRole("button", { name: "Not now" }).click();
  await tapped;
  await page.waitForLoadState("networkidle");
  // Right after the tap, and when the chat is opened again as someone coming back would.
  for (const when of ["after the tap", "after opening the chat again"]) {
    if (when !== "after the tap") {
      await page.goto(CHAT);
      await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible({
        timeout: 60_000,
      });
    }
    const after = await messages.allInnerTexts();
    const traces = after.filter((t) => t.includes(headline));
    expect(traces, `${when}: the tapped suggestion "${headline}" is in the chat`).toEqual([]);
    expect(after.length, `${when}: the chat gained a message from the tap`).toBe(before.length);
  }
});

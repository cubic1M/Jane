import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { answerTo, landInChat } from "./chat-page";
import { holds } from "./waits";

// Founder (11-11): "the chat often reloads the response for some reason after producing a
// response. I don't want to see that happen." What the person reads of Jane's answer only ever
// grows, through a rewrite (the scripted fake's first draft is blocked, src/lib/jane-agent/
// fake-chat-claude.ts) and through the swap from the streamed draft to the stored message; and
// the stored message isn't drawn again afterwards.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(150_000);

const QUESTION = "Should I pay off my card before saving?";

const users: string[] = [];
test.afterEach(async () => {
  for (const id of users.splice(0)) await deleteUser(id);
});

test("a reply stays as it streamed: never cleared, replaced or drawn again", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  users.push(user.userId);
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
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible({
    timeout: 60_000,
  });

  // Every change to the page, the answer as the person sees it then: the streamed draft while
  // there is one, else the newest answer in the list.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const answerNow = () => {
      const draft = document.querySelector("[data-draft-answer]");
      if (draft) return draft.textContent ?? "";
      const answers = document.querySelectorAll('li[data-from="answer"] [data-private]');
      return answers.length > 0 ? (answers[answers.length - 1]!.textContent ?? "") : "";
    };
    const before = answerNow();
    new MutationObserver(() => {
      const now = answerNow();
      if (now !== before && now !== seen.at(-1)) seen.push(now);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  const ask = page.getByRole("textbox", { name: "Message Jane" });
  await ask.fill(QUESTION);
  await ask.press("Enter");
  const answer = await answerTo(page, "could save you the most");
  await expect(answer).toContainText("I can help you plan the payments");

  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.length).toBeGreaterThan(0);
  // Each step goes on from the one before: nothing taken back, nothing written again.
  for (let i = 1; i < seen.length; i += 1) {
    expect(seen[i]!.startsWith(seen[i - 1]!), `${seen[i - 1]} -> ${seen[i]}`).toBe(true);
  }
  expect(seen.join("\n")).not.toMatch(/definitely/);

  // The stored message stays the same element: no reload draws it again.
  await answer.evaluate((el) => ((el as unknown as { marked: boolean }).marked = true));
  await holds(async () => {
    expect(await answer.evaluate((el) => (el as unknown as { marked?: boolean }).marked)).toBe(
      true,
    );
  }, 4_000);
});

// Founder (11-11): "the width is fixed, but the height increases and matches the amount of
// text": up to about 40% of the screen showing, then it scrolls inside; one line again once sent.
test("the message box grows with the text, keeps its width, and shrinks once sent", async ({
  context,
  page,
  baseURL,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const user = await signedInUser("user");
  users.push(user.userId);
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

  const box = page.getByRole("textbox", { name: "Message Jane" });
  await expect(box).toBeEditable({ timeout: 60_000 });
  const one = (await box.boundingBox())!;

  await box.fill("How much is safe to spend this week, and what about the next one after it?");
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(one.height);
  const grown = (await box.boundingBox())!;
  expect(Math.round(grown.width)).toBe(Math.round(one.width));
  // Nothing hidden while it fits: no scrolling inside yet.
  expect(await box.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);

  // Far more than fits: at most 40% of the screen, and it scrolls inside.
  await box.fill(
    Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long question.`).join("\n"),
  );
  await expect
    .poll(async () => (await box.boundingBox())!.height)
    .toBeLessThanOrEqual(Math.ceil(812 * 0.4));
  expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // Shift+Enter is a new line, not a send.
  await box.fill("first line");
  await box.press("Shift+Enter");
  await expect(box).toHaveValue("first line\n");

  // Sent: one line again.
  await box.fill("How much is safe to spend? It's for the whole week, groceries and all.");
  await box.press("Enter");
  await expect(page.getByText("for the whole week, groceries and all").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(async () => Math.round((await box.boundingBox())!.height))
    .toBe(Math.round(one.height));
});

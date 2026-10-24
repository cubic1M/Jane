import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { CHAT, landInChat } from "./chat-page";

// Spec steps 81–82: link the demo bank, land in Jane's chat, see the morning brief, tap
// Yes on a finding and see it answered. On a phone, with nothing sideways and the tab bar
// clear of the newest message. Spec step 83: answer the autopilot question there too.
// Spec step 84: type to Jane and get an answer. Spec step 86: a finding's page links back.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
// Every button but Pin (spec step 96) and Read aloud (spec step 186), which every message of
// Jane's has.
const NOT_PIN = /^(?!(?:Pin|Unpin|Read aloud|Stop reading)$)/;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("the demo bank lands in Jane's chat, and Yes answers a finding", async ({
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
  // A click that lands before the page has hydrated can be lost, so click until it takes
  // (linking the demo bank twice is harmless: the second one finds the first).
  await expect(async () => {
    if (page.url().endsWith("/connect")) {
      await page.getByRole("button", { name: "Link a demo bank" }).click({ timeout: 5_000 });
    }
    await landInChat(page, 15_000);
  }).toPass({ timeout: 90_000 });
  // The first visit runs Jane's whole pass over the new bank, which can take a while.
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible({
    timeout: 60_000,
  });
  // The agenda and the suggestions come in the work after the first brief: wait for it, then look.
  await waitForFullScan(user.userId);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible();

  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  const ask = page.getByRole("textbox", { name: "Message Jane" });

  // Spec step 184: the day in one message. The agenda says what needs a yes, a Yes each,
  // and "Approve all safe ones"; each Yes is that thing's own.
  const agenda = messages.filter({ hasText: /Good (morning|afternoon|evening)! / });
  await expect(agenda).toHaveCount(1);
  await expect(agenda).toContainText("need your yes:");
  await expect(agenda.getByRole("button", { name: "Approve all safe ones" })).toBeVisible();
  await agenda
    .getByRole("button", { name: /^\[?Yes: / })
    .first()
    .click();
  await expect(agenda.getByRole("status")).toContainText(":");

  // Asked about something, Jane answers with its Yes, No and "Why?" (spec step 90): "Why?"
  // answers in the chat from the finding's own evidence, and leaves the decision open.
  await ask.fill("cancel hulu");
  await ask.press("Enter");
  await expect(messages.last()).toContainText("Want me to handle it?");
  const body = (await messages.last().locator("p").nth(1).textContent()) ?? "";
  expect(body).toContain("Want me to handle it?");
  const finding = messages.filter({ hasText: body });
  await finding.getByRole("button", { name: "Why?" }).click();
  await expect(messages.last()).toContainText("If you say yes:");
  await expect(finding.getByRole("button", { name: "Why?" })).toHaveCount(0);
  await expect(finding.getByRole("button", { name: "Yes", exact: true })).toBeVisible();

  // Yes answers it, found again by its words once its buttons are gone.
  // The tap shows its result at once (before the server has saved it): wait for the save
  // before reloading, as a person would by looking at the screen settle.
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/chat",
  );
  await finding.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(finding.getByText("You chose:")).toBeVisible();
  await saved;
  await expect(finding.getByRole("button", { name: NOT_PIN })).toHaveCount(0);
  await expect(finding.getByRole("link", { name: /Open/ })).toBeVisible();

  // Still answered after a reload.
  await page.reload();
  await expect(messages.filter({ hasText: body }).getByText("You chose:")).toBeVisible();

  // Spec step 86: the finding's page shows the same answer and links back to its message.
  // A plain link: it works before the reloaded page has hydrated (spec step 194).
  await messages.filter({ hasText: body }).getByRole("link", { name: /Open/ }).click();
  await expect(page).toHaveURL(/\/report\/[^?]+\?from=/);
  await expect(page.getByText("You chose: Yes, in the chat.")).toBeVisible();
  await page.getByRole("link", { name: /Back to the chat/ }).click();
  // The chat has no page of its own: Home, with the chat open beside it at that message.
  await expect(page).toHaveURL(/\/home(\?|$)/);
  await page.goto(CHAT);

  // Spec step 83: the autopilot question, answered with one tap.
  const autopilot = messages.filter({ hasText: "How much should I do on my own?" });
  await expect(autopilot).toHaveCount(1);
  await autopilot.getByRole("button", { name: "Handle the safe stuff" }).click();
  await expect(autopilot.getByText("You chose:")).toBeVisible();
  await expect(autopilot.getByRole("status")).toContainText("I'll handle the safe stuff");
  await expect(autopilot.getByRole("button", { name: NOT_PIN })).toHaveCount(0);

  // The chat as the side panel shows it: no page header of its own, the message box at the end.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(ask).toHaveAttribute("placeholder", "Ask Jane anything");

  // Typing a question (spec step 84): it shows as the person's message, with Jane's answer
  // under it, and the box clears.
  await ask.fill("safe to spend");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("safe to spend", { exact: true })).toBeVisible();
  await expect(messages.last()).toContainText(/You have \$[\d,]+\.\d\d safe to spend/);
  await expect(ask).toHaveValue("");
  // Jane's answer looks different from what she brings up on her own.
  await expect(messages.last()).toHaveAttribute("data-from", "answer");
  await expect(messages.filter({ hasText: /Good (morning|afternoon|evening)!/ })).toHaveAttribute(
    "data-from",
    "jane",
  );

  // A command answers with buttons and does nothing until one is tapped.
  await ask.fill("yes to all");
  await ask.press("Enter");
  await expect(messages.last()).toContainText("on your plan");
  await expect(messages.last().getByRole("link", { name: /Review the plan/ })).toBeVisible();

  // Spec step 88: a name that could mean two things gets a question with a button each,
  // and the tap answers it in the chat.
  await ask.fill("cancel streaming");
  await ask.press("Enter");
  await expect(messages.last()).toContainText("Which one do you mean?");
  // Found by its words: once answered, it's no longer the last message.
  const question = messages.filter({ hasText: "Which one do you mean?" }).last();
  await question.getByRole("button", { name: NOT_PIN }).first().click();
  await expect(question.getByText("You chose:")).toBeVisible();
  await expect(messages.last()).toContainText("Want me to handle it?");
  await expect(messages.last().getByRole("button", { name: "Yes", exact: true })).toBeVisible();

  // Spec step 94: a timeline drawn in monospace, fitting the phone, with a text alternative.
  await ask.fill("what's due this week");
  await ask.press("Enter");
  const due = messages.last().locator("figure");
  await expect(due).toBeVisible();
  await expect(due.locator("figcaption")).toHaveText("Due this week");
  await expect(due.locator(".sr-only")).toContainText("Due this week: ");
  expect(await due.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // Spec step 95: a guided flow, one question at a time in the same message; Cancel changes
  // nothing.
  await ask.fill("set up a budget");
  await ask.press("Enter");
  const flow = messages.filter({ hasText: "Setting up a budget" }).last();
  await expect(flow).toContainText("1 of 2");
  await flow.getByRole("button", { name: NOT_PIN }).first().click();
  await expect(flow).toContainText("2 of 2");
  await flow.getByRole("button", { name: "Cancel" }).click();
  await expect(flow.getByRole("status")).toContainText("Nothing was changed.");

  // Spec step 91: Jane remembers what she's told, only on the tap, and Settings can forget it.
  await ask.fill("payday is the 15th");
  await ask.press("Enter");
  const told = messages.filter({ hasText: "I can remember that: payday is the 15th." }).last();
  await expect(told).toBeVisible();
  await told.getByRole("button", { name: "Remember this" }).click();
  await expect(told.getByRole("status")).toContainText("Saved.");
  await page.goto("/settings#remembers");
  const remembers = page.locator("#remembers");
  await expect(remembers).toContainText("Payday is the 15th");
  await remembers.getByRole("button", { name: /Forget/ }).click();
  await expect(remembers).toContainText("Nothing yet.");
  await page.goto(CHAT);

  // Spec step 96: search the chat, and pin a message to the top.
  await page.getByRole("searchbox", { name: "Search the chat" }).first().fill("safe to spend");
  await page.getByRole("button", { name: "Search" }).first().click();
  await expect(page).toHaveURL(/\/chat\/search\?q=safe/);
  await expect(page.getByRole("status")).toContainText('found for "safe to spend"');
  await page.goto(CHAT);
  const pinIt = messages.filter({ hasText: /Good (morning|afternoon|evening)!/ });
  await pinIt.getByRole("button", { name: "Pin" }).click();
  await expect(page.getByRole("region", { name: "Pinned" })).toContainText(
    /Good (morning|afternoon|evening)!/,
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Opened at the end: the whole message box is on screen (no tab bar along the bottom now).
  await page.goto(CHAT);
  await expect(ask).toBeInViewport({ ratio: 1 });
});

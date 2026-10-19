import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";

// Spec steps 81–82: link the demo bank, land in Jane's chat, see the morning brief, tap
// Yes on a finding and see it answered. On a phone, with nothing sideways and the tab bar
// clear of the newest message. Spec step 83: answer the autopilot question there too.
// Spec step 84: type to Jane and get an answer. Spec step 86: a finding's page links back.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(120_000);
test.use({ viewport: { width: 375, height: 812 } });

let userId: string | undefined;
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
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  await expect(page).toHaveURL("/chat", { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Chat with Jane" })).toBeVisible();

  const messages = page.getByRole("list", { name: "Messages" }).getByRole("listitem");
  await expect(messages.filter({ hasText: /Good (morning|afternoon|evening)!/ })).toHaveCount(1);
  await expect(messages.filter({ hasText: "Your plan for this week is ready" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Approve all safe ones" })).toBeVisible();

  // A finding, found again by its words once its buttons are gone.
  const first = messages.filter({ hasText: "Want me to handle it?" }).first();
  const body = (await first.locator("p").nth(1).textContent()) ?? "";
  expect(body).toContain("Want me to handle it?");
  const finding = messages.filter({ hasText: body });
  await finding.getByRole("button", { name: "Yes", exact: true }).click();
  await expect(finding.getByText("You chose:")).toBeVisible();
  await expect(finding.getByRole("button")).toHaveCount(0);
  await expect(finding.getByRole("link", { name: /Open/ })).toBeVisible();

  // Still answered after a reload.
  await page.reload();
  await expect(messages.filter({ hasText: body }).getByText("You chose:")).toBeVisible();

  // Spec step 86: the finding's page shows the same answer and links back to its message.
  await messages.filter({ hasText: body }).getByRole("link", { name: /Open/ }).click();
  await expect(page).toHaveURL(/\/report\/[^?]+\?from=/);
  await expect(page.getByText("You chose: Yes, in the chat.")).toBeVisible();
  await page.getByRole("link", { name: /Back to the chat/ }).click();
  await expect(page).toHaveURL(/\/chat#/);

  // Spec step 83: the autopilot question, answered with one tap.
  const autopilot = messages.filter({ hasText: "How much should I do on my own?" });
  await expect(autopilot).toHaveCount(1);
  await autopilot.getByRole("button", { name: "Handle the safe stuff" }).click();
  await expect(autopilot.getByText("You chose:")).toBeVisible();
  await expect(autopilot.getByRole("status")).toContainText("I'll handle the safe stuff");
  await expect(autopilot.getByRole("button")).toHaveCount(0);

  // Chat is the first tab and lit up; the message box is at the end.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link").first()).toHaveAccessibleName("Chat");
  await expect(nav.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
  const ask = page.getByRole("textbox", { name: "Message Jane" });
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

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Opened at the end: the message box sits above the tab bar.
  await page.reload();
  await expect(ask).toBeInViewport();
  const navTop = (await nav.boundingBox())?.y ?? 0;
  const box = await ask.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(navTop + 1);
});

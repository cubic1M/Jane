import { expect, test } from "@playwright/test";
import { answerTo, landInChat } from "./chat-page";

// "Give me a summary of who I am" (founder, 2026-10-26): a visitor tries Jane as the Reyes family,
// asks who they are, and the answer has the kids and the pet that Jane read from the payments,
// said as sure as it is, with the way to correct it. No Claude key in the end-to-end server, so
// the answer is Jane's own (src/lib/jane-agent/who-am-i.ts), the same paragraph Claude is given.
test.skip(!process.env.E2E_DATABASE_URL, "needs E2E_DATABASE_URL");

test("a Try Jane family asks who they are and hears about the kids and the pet", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("checkbox").check();
  await page.getByLabel("Whose money to try").selectOption("family");
  await page.getByRole("button", { name: "Try it with sample data" }).click();
  await landInChat(page);

  await page.getByRole("textbox", { name: "Message Jane" }).fill("give me a summary of who I am");
  await page.getByRole("button", { name: "Send" }).click();

  const answer = await answerTo(page, "picture I have of you");
  await expect(answer).toContainText("have kids at home");
  await expect(answer).toContainText("have a pet");
  await expect(answer).toContainText("own your home");
  // Not a person with no children or no pet; and the way to correct it.
  await expect(answer).not.toContainText("new baby");
  await expect(answer).not.toContainText("a student");
  await expect(answer.getByRole("link", { name: "What Jane knows about you" })).toHaveAttribute(
    "href",
    /^\/profile(\?|$)/,
  );
});

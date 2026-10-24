import { expect, test, type Locator } from "@playwright/test";
import { pickItem } from "./area-tree";
import { E2E_DATABASE_URL, deleteUser, signedInUser, waitForFullScan } from "./db";
import { landInChat } from "./chat-page";

// Comparison cards (founder, 2026-10-24): where Jane recommends insurance or a loan, the options
// side by side on a wide screen, each with its tags and rows; "Sort by" re-ranks them on the
// screen, and one tap chooses, shown at once and queued behind. The phone's stack and Compare
// table are in chat-options.spec.ts.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);
test.use({ viewport: { width: 1280, height: 900 } });

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

const order = (cards: Locator) =>
  cards.evaluateAll((items) => items.map((li) => li.getAttribute("data-option-id") ?? ""));

test("insurance options side by side, re-ranked by preference, chosen in one tap", async ({
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

  await page.goto("/insurance");
  await pickItem(page, "Insurance", "Your perfect coverage", "first-open");
  await page.getByRole("link", { name: "See options" }).click();
  const compared = page.getByTestId("comparison");
  await expect(compared).toBeVisible();
  const cards = compared.locator("li[data-option-id]");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(4);

  // Side by side: the first row of cards shares a top edge.
  const tops = await cards.evaluateAll((items) =>
    items.map((li) => Math.round(li.getBoundingClientRect().top)),
  );
  expect(tops[1]).toBe(tops[0]);
  // Each card: a name, a monthly figure, its rows; rows that differ are marked.
  await expect(cards.first().getByRole("heading", { level: 4 })).not.toBeEmpty();
  await expect(cards.first().getByText("/mo")).toBeVisible();
  await expect(compared.locator("[data-row][data-differs]").first()).toBeVisible();
  // A short tag on the cheapest, and the demo advice label.
  await expect(compared.locator('[data-tag="CHEAPEST"]')).toHaveCount(1);
  await expect(compared.getByText("Demo advice: sample data, not financial advice")).toBeVisible();

  // Sort by: cheapest first, then the most cover first, without a trip to the server.
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") requests.push(r.url());
  });
  await compared.getByText("Cheapest", { exact: false }).first().click();
  await expect(cards.first().locator('[data-tag="CHEAPEST"]')).toBeVisible();
  const cheapest = await order(cards);
  await compared.getByText("Best coverage").click();
  await expect.poll(() => order(cards)).not.toEqual(cheapest);
  const byCover = await order(cards);
  expect([...byCover].sort()).toEqual([...cheapest].sort());
  expect(byCover[0]).not.toBe(cheapest[0]);
  expect(requests).toEqual([]);

  // More details: the reasoning and how sure she is, on her pick.
  const pick = cards.filter({ hasText: "JANE'S PICK" });
  await pick.getByRole("button", { name: /More details/ }).click();
  await expect(pick.getByText(/\d+% sure:/)).toBeVisible();

  // One tap: the card turns inverted at once, then the team has it.
  const name = ((await pick.getByRole("heading", { level: 4 }).textContent()) ?? "").trim();
  const started = Date.now();
  await pick.getByRole("button", { name: `Choose ${name}` }).click();
  await expect(pick).toHaveAttribute("data-chosen", "", { timeout: 100 });
  expect(Date.now() - started).toBeLessThan(1_000);
  await expect(pick.getByRole("button", { name: `Chosen: ${name}` })).toBeVisible();
  await expect(compared.getByRole("status")).toContainText("My team will", { timeout: 30_000 });
  // The others can't be chosen as well.
  await expect(
    cards
      .filter({ hasNotText: "JANE'S PICK" })
      .first()
      .getByRole("button", {
        name: /^Choose /,
      }),
  ).toBeDisabled();
});

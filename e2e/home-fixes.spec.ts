import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, addJaneMessage, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Founder's Home fixes (2026-10-25): an opened card in the dock stays put through a reload and
// while stepping; "Hide this for good" is instant; an area's tree starts at its branches; and
// no "Good morning" greeting for now.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(240_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("an opened card stays put through a reload and while stepping", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is on a computer");
  await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  const dock = page.locator("[data-card-dock]");
  const header = dock.locator("[data-dock-header]");
  await expect(header).toHaveText(/of (\d+) suggestions/, { timeout: 60_000 });
  const total = Number(/of (\d+)/.exec((await header.textContent()) ?? "")![1]);
  test.skip(total < 6, "needs a few cards");
  const showing = dock.locator('[data-card-state="showing"]');
  const headline = showing.getByRole("heading", { level: 3 });
  const more = showing.getByRole("button", { name: "More details" });

  // Well down the stack, opened.
  for (let i = 0; i < 4; i += 1)
    await dock.getByRole("button", { name: "Next suggestion" }).click();
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const was = (await headline.textContent()) ?? "";
  // Opened, it stays short (QA round 12): its buttons in view inside the dock, and the chat
  // under it keeps its room.
  await page.waitForTimeout(500);
  const dockBox = (await dock.boundingBox())!;
  const buttons = showing.locator("[data-card-actions] button");
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    const b = (await button.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(dockBox.y + dockBox.height + 1);
  }
  const frame = (await page.locator('iframe[title="Chat with Jane"]').boundingBox())!;
  expect(frame.height).toBeGreaterThan(900 * 0.3);

  // Something new comes in ahead of it, and the dock reloads in the background.
  await addJaneMessage(userId, {
    kind: "decision",
    body: "Check your new card's annual fee.\nIt starts next month.",
    refs: {},
    actions: [{ id: "autopilot.safe", label: "Look into it", kind: "primary" }],
  });
  // (The stack keeps its newest cards, so the count may stay the same: the new one is in, the
  // oldest out.)
  const reloaded = page.waitForResponse((r) => r.url().includes("/api/chat/cards"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await reloaded;
  await page.waitForTimeout(1_000);
  await expect(headline).toHaveText(was);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(showing.locator('[id^="details-"]')).toBeVisible();

  // Stepping while opened: the next and back again are opened too.
  await dock.getByRole("button", { name: "Next suggestion" }).click();
  await expect(headline).not.toHaveText(was);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await dock.getByRole("button", { name: "Previous suggestion" }).click();
  await expect(headline).toHaveText(was);
  await expect(more).toHaveAttribute("aria-expanded", "true");
});

test("an opened card keeps the next ones open, until one is shut", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the dock is on a computer");
  await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");
  const dock = page.locator("[data-card-dock]");
  const header = dock.locator("[data-dock-header]");
  await expect(header).toHaveText(/of (\d+) suggestions/, { timeout: 60_000 });
  const total = Number(/of (\d+)/.exec((await header.textContent()) ?? "")![1]);
  test.skip(total < 4, "needs a few cards");
  const showing = dock.locator('[data-card-state="showing"]');
  const headline = showing.getByRole("heading", { level: 3 });
  const more = showing.getByRole("button", { name: "More details" });
  const answer = () => showing.locator("[data-card-actions] button").last();

  // Opened, then answered: the next card is already open, with no shut moment in between.
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  for (let i = 0; i < 2; i += 1) {
    const was = (await headline.textContent()) ?? "";
    await answer().click();
    await expect(headline).not.toHaveText(was);
    expect(
      await showing.evaluate((card) =>
        card.querySelector('[aria-label="More details"]')?.getAttribute("aria-expanded"),
      ),
    ).toBe("true");
    await expect(showing.locator('[id^="details-"]')).toBeVisible();
  }
  // Shut by the person: the next ones come shut again.
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  const was = (await headline.textContent()) ?? "";
  await answer().click();
  await expect(headline).not.toHaveText(was);
  await expect(more).toHaveAttribute("aria-expanded", "false");
});

test("Home: hide the checklist at once, trees start at their branches, no greeting", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  // "Hide this for good": gone on the tap, and still gone after a reload.
  const checklist = page.getByRole("region", { name: "Getting started" });
  if ((await checklist.count()) > 0) {
    // Gone in the same frame as the tap (QA round 12: it took about half a second).
    await expect(checklist.getByRole("button", { name: "Hide this for good" })).toBeEnabled();
    const goneAtOnce = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Hide this for good",
      )!;
      button.click();
      return document.getElementById("checklist-heading") === null;
    });
    expect(goneAtOnce).toBe(true);
    await expect(checklist).toHaveCount(0);
    await page.waitForTimeout(1_500);
    await page.reload();
    await expect(page.locator("[data-giant-tree]")).toBeVisible({ timeout: 60_000 });
    await expect(checklist).toHaveCount(0);
  }

  // An area opens straight into its branches: nothing in it repeats the area's name.
  const tree = page.locator("[data-giant-tree]");
  await tree.locator('[data-giant-area-tile="taxes"]').click();
  const area = tree.locator('[data-giant-area="taxes"]');
  await expect(area.locator("[data-giant-branch]").first()).toBeVisible();
  await expect(area.getByText("Taxes", { exact: true })).toHaveCount(0);

  // No "Good morning" and no "Hi, I'm Jane" anywhere: not among the cards, not in the chat.
  const cards = await page.evaluate(async () =>
    ((await (await fetch("/api/chat/cards")).json()).cards as { body: string }[]).map(
      (c) => c.body,
    ),
  );
  expect(cards.filter((b) => /^Good (morning|afternoon|evening)!/.test(b))).toEqual([]);
  expect(cards.filter((b) => /^Hi, I'm Jane\./.test(b))).toEqual([]);
  await page.goto("/chat?embed=1");
  await expect(page.getByRole("textbox", { name: "Message Jane" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/^Good (morning|afternoon|evening)!/)).toHaveCount(0);
  await expect(page.getByText(/^Hi, I'm Jane\./)).toHaveCount(0);
  // And no search box in the chat (founder, 2026-10-26).
  await expect(page.getByRole("searchbox", { name: "Search the chat" })).toHaveCount(0);
});

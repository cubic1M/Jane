import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Jane's cards (docs/design/area-pages.md): on a computer they sit in a dock directly above
// the side chat, in the right column and never in the chat itself, a little bigger, one at a
// time with "+N" and arrows. On a phone they pop up at the bottom of Home, a short card that
// never covers more than about a third of the screen. Either way the details open in place
// with the chevron, and the next card is on screen within 100 ms of a tap.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

test("suggestions pop up small at the bottom of the hub and open in place", async ({
  context,
  page,
  baseURL,
  isMobile,
}) => {
  // A computer, or a small phone (375 x 812).
  await page.setViewportSize(isMobile ? { width: 375, height: 812 } : { width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  const panel = page.getByRole("complementary", { name: "Chat with Jane" });
  const overlay = (isMobile ? page : panel).getByRole("region", { name: "Suggestions for you" });
  await expect(overlay).toBeVisible({ timeout: 60_000 });
  const showing = overlay.locator('[data-card-state="showing"]');
  const viewport = page.viewportSize()!;

  // The page has settled (the Jane button or the docked chat is in).
  if (isMobile) await expect(page.getByRole("button", { name: /^Chat with Jane/ })).toBeVisible();
  else await expect(page.getByRole("complementary", { name: "Chat with Jane" })).toBeVisible();

  // On a small phone they start folded into one line at the very bottom, beside the Jane
  // button, so the net worth isn't covered (QA round 6); a tap opens them.
  if (isMobile) {
    const fold = overlay.locator('[data-card-state="folded"]');
    await expect(fold).toHaveText(/^\[JANE\]\d+ for you▲$/);
    await expect(showing).toHaveCount(0);
    const box = (await fold.boundingBox())!;
    const figure = (await page.locator('[data-hub-number="net-worth"]').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(figure.y + figure.height);
    const jane = (await page.getByRole("button", { name: /^Chat with Jane/ }).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(jane.x + 1);
    await fold.click();
    await expect(fold).toHaveCount(0);
  }

  // Shut: a headline, Yes and Not now, and a third of the screen at most.
  const shut = (await showing.boundingBox())!;
  expect(shut.height).toBeLessThan(viewport.height / 3);
  await expect(showing.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await expect(showing.getByRole("button", { name: "Not now", exact: true })).toBeVisible();
  const counter = overlay.locator("p[aria-live]");
  const total = Number(((await counter.textContent()) ?? "").split(" ")[0]);
  // How many: "+N" on the stack on a phone; the dock's header line on a computer.
  if (isMobile && total > 1) await expect(showing).toContainText(`+${total - 1}`);
  if (!isMobile) {
    await expect(overlay.locator("[data-dock-header]")).toContainText(
      `1 of ${total} ${total === 1 ? "suggestion" : "suggestions"}`,
    );
  }

  // Clear of the Jane button on a phone, and of the docked chat on a computer.
  if (isMobile) {
    const jane = (await page.getByRole("button", { name: /^Chat with Jane/ }).boundingBox())!;
    expect(shut.y + shut.height).toBeLessThanOrEqual(jane.y + 1);
  } else {
    // Above the chat, in its column: the page has no floating stack of its own, and the chat
    // has no card in it.
    const box = (await panel.boundingBox())!;
    expect(shut.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(shut.x + shut.width).toBeLessThanOrEqual(box.x + box.width + 1);
    const frame = (await page.locator('iframe[title="Chat with Jane"]').boundingBox())!;
    expect(shut.y + shut.height).toBeLessThanOrEqual(frame.y + 1);
    await expect(page.locator('.floating-cards[data-floating-cards="queue"]')).toBeHidden();
    const chat = page.frameLocator('iframe[title="Chat with Jane"]');
    await expect(chat.getByRole("textbox", { name: "Message Jane" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(chat.getByRole("region", { name: "Suggestions for you" })).toBeHidden();
    // Whole: the headline is never cut short.
    const heading = showing.getByRole("heading", { level: 3 });
    await expect(heading).not.toContainText("…");
    expect(await heading.evaluate((h) => h.scrollWidth <= h.clientWidth + 1)).toBe(true);
    // The arrows step through the cards and back.
    if (total > 1) {
      const first = (await heading.textContent()) ?? "";
      await overlay.getByRole("button", { name: "Next suggestion" }).click();
      await expect(heading).not.toHaveText(first);
      await overlay.getByRole("button", { name: "Previous suggestion" }).click();
      await expect(heading).toHaveText(first);
    }
  }

  // The buttons sit in one row, every label whole (founder: "lined up horizontally in one line
  // instead of stacked on each other").
  const actions = showing.locator("[data-card-actions] button");
  const rows = await actions.evaluateAll((els) =>
    els.map((e) => ({
      top: Math.round(e.getBoundingClientRect().top),
      whole: e.scrollWidth <= e.clientWidth + 1,
    })),
  );
  expect(new Set(rows.map((r) => r.top)).size).toBe(1);
  expect(rows.every((r) => r.whole)).toBe(true);

  // The chevron opens the details in place, bigger: why, what Yes does, and how sure last.
  const more = showing.getByRole("button", { name: "More details" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const details = showing.locator('[id^="details-"]');
  await expect(details).toBeVisible();
  await expect(details).toContainText("What Yes does:");
  // Paragraphs with room between them, and the confidence on its own line at the end.
  const blocks = details.locator("p");
  expect(await blocks.count()).toBeGreaterThan(1);
  const [a, b] = await blocks.evaluateAll((els) =>
    els.slice(0, 2).map((e) => e.getBoundingClientRect()),
  );
  expect(b.top - a.bottom).toBeGreaterThanOrEqual(8);
  const sure = details.locator("[data-card-confidence]");
  await expect(sure).toHaveText(/^\d+% sure:/);
  expect(
    await details.evaluate((el) => {
      const ps = [...el.querySelectorAll("p, ul, dl, a, button")];
      return ps[ps.length - 1]?.hasAttribute("data-card-confidence");
    }),
  ).toBe(true);
  // Bigger open than shut, and never past about 70% of the screen; it shrinks back after.
  await expect.poll(async () => (await showing.boundingBox())!.height).toBeGreaterThan(shut.height);
  expect((await showing.boundingBox())!.height).toBeLessThan(viewport.height * 0.8);
  await more.click();
  await expect(details).toBeHidden();
  await expect
    .poll(async () => (await showing.boundingBox())!.height)
    .toBeLessThan(shut.height + 4);

  // Not now: the next card is on screen within 100 ms.
  const headline = showing.getByRole("heading", { level: 3 });
  const first = (await headline.textContent()) ?? "";
  await showing.getByRole("button", { name: "Not now", exact: true }).click();
  if (total > 1) {
    await expect(headline).not.toHaveText(first, { timeout: 100 });
    await expect(counter).toHaveText(`${total - 1} left`, { timeout: 100 });
  } else {
    await expect(overlay).toBeHidden({ timeout: 1_000 });
  }
});

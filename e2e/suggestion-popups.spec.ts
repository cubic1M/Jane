import { expect, test } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser } from "./db";
import { demoPerson } from "./demo-person";

// Suggestions as compact pop-ups (docs/design/home-hub.md): on Home they pop up at the bottom
// of the hub, a short card that never covers more than about a third of the screen, the cards
// behind it counted, the details opening in place with the chevron, and the next card on
// screen within 100 ms of a tap. Beside Home the docked chat leaves them out, so they show
// once.

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
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  userId = await demoPerson(context, page, baseURL);
  await page.goto("/home");

  const overlay = page.getByRole("region", { name: "Suggestions for you" });
  await expect(overlay).toBeVisible({ timeout: 60_000 });
  const showing = overlay.locator('[data-card-state="showing"]');
  const viewport = page.viewportSize()!;

  // Shut: a headline, Yes and Not now, and a third of the screen at most.
  const shut = (await showing.boundingBox())!;
  expect(shut.height).toBeLessThan(viewport.height / 3);
  await expect(showing.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await expect(showing.getByRole("button", { name: "Not now", exact: true })).toBeVisible();
  const counter = overlay.locator("p[aria-live]");
  const total = Number(((await counter.textContent()) ?? "").split(" ")[0]);
  if (total > 1) await expect(showing).toContainText(`+${total - 1}`);

  // Clear of the Jane button on a phone, and of the docked chat on a computer.
  if (isMobile) {
    const jane = (await page.getByRole("button", { name: /^Chat with Jane/ }).boundingBox())!;
    expect(shut.y + shut.height).toBeLessThanOrEqual(jane.y + 1);
  } else {
    const panel = (await page
      .getByRole("complementary", { name: "Chat with Jane" })
      .boundingBox())!;
    expect(shut.x + shut.width).toBeLessThanOrEqual(panel.x + 1);
    // The chat beside Home leaves the suggestions to the hub.
    const chat = page.frameLocator('iframe[title="Chat with Jane"]');
    await expect(chat.getByRole("textbox", { name: "Message Jane" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(chat.getByRole("region", { name: "Suggestions for you" })).toBeHidden();
  }

  // The chevron opens the details in place: why, how sure and what Yes does.
  const more = showing.getByRole("button", { name: "More details" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const details = showing.locator('[id^="details-"]');
  await expect(details).toBeVisible();
  await expect(details).toContainText(/\d+% sure:/);
  await expect(details).toContainText("What Yes does:");
  await expect
    .poll(async () => (await showing.boundingBox())!.height)
    .toBeLessThan(viewport.height * 0.5);
  await more.click();
  await expect(details).toBeHidden();

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

import { expect, test, type Page } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { uploadSampleCard } from "./demo-upload";

// What looked rough on camera around the chat (demo-video list): after an upload the side chat
// catches up without a reload and brings Jane's cards, each saying how sure Jane is in view; the
// import chip sits clear of the page's headings and goes once the findings are open; and on a
// phone the Jane button tucks away while reading.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.setTimeout(180_000);

let userId: string | undefined;
test.afterEach(async () => {
  if (userId) await deleteUser(userId);
});

async function signIn(page: Page, baseURL: string | undefined) {
  const user = await signedInUser("user");
  userId = user.userId;
  await page
    .context()
    .addCookies([{ name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" }]);
}

const apart = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.y + a.height <= b.y || b.y + b.height <= a.y || a.x + a.width <= b.x || b.x + b.width <= a.x;

test("after an upload the side chat catches up, and the chip keeps out of the way", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(isMobile, "the docked chat is the computer's");
  await page.setViewportSize({ width: 1280, height: 800 });
  await signIn(page, baseURL);

  // Before: the chat asks for a statement, in one sentence.
  await page.goto("/import");
  const chat = page.frameLocator('iframe[title="Chat with Jane"]');
  await expect(chat.locator("[data-chat-embed]").first()).toContainText(
    "Upload a bank statement and I'll start looking after your money.",
  );

  await uploadSampleCard(page);
  // The chip sits clear of the page's headings.
  const chip = (await page.locator("[data-import-chip]").boundingBox())!;
  for (const heading of await page.locator("main h1, main h2").all()) {
    const box = await heading.boundingBox();
    if (box) expect(apart(chip, box)).toBe(true);
  }
  // The chat caught up without a reload, and Jane's cards came with it, each saying how sure.
  await expect(chat.getByText("Upload a bank statement")).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator("[data-card-dock] [data-card-sure]")).toHaveText(/^\d+% sure$/, {
    timeout: 60_000,
  });
  // And the chat under them doesn't say there's nothing new (demo-video re-take).
  await expect(chat.getByText("Nothing new from me yet")).toHaveCount(0);

  // On the findings the chip has said its piece and goes, and stays gone.
  await page.goto("/report");
  await expect(page.locator("[data-import-chip]")).toHaveCount(0);
  await page.goto("/home");
  await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
  await expect(page.locator("[data-import-chip]")).toHaveCount(0);
});

test("on a phone, the Jane button tucks away while reading", async ({
  page,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "the phone's button");
  await signIn(page, baseURL);
  await uploadSampleCard(page);
  await page.goto("/home");
  const fab = page.locator("#jane-fab");
  await expect(fab).toBeVisible();
  await expect(fab).not.toHaveAttribute("data-tucked", "");
  // Scrolled down (again, until the page is listening): out of the way.
  await expect(async () => {
    await page.evaluate(() => window.scrollBy(0, 150));
    await expect(fab).toHaveAttribute("data-tucked", "", { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  // Scrolled back up: back.
  await page.evaluate(() => window.scrollBy(0, -120));
  await expect(fab).not.toHaveAttribute("data-tucked", "");
});

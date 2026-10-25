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
    await checklist.getByRole("button", { name: "Hide this for good" }).click();
    await expect(checklist).toHaveCount(0, { timeout: 300 });
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
  // The map too.
  await page.goto("/home/map");
  const map = page.getByRole("tree", { name: /^What Jane does: / });
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(map.locator('[role="treeitem"][aria-level="1"]').first()).toBeVisible();
  const chip = await page
    .getByRole("group", { name: "Areas" })
    .getByRole("button", { pressed: true })
    .textContent();
  const areaName = (chip ?? "").split("·")[0].trim();
  await expect(map.getByRole("treeitem", { name: new RegExp(`^${areaName}`) })).toHaveCount(0);

  // No "Good morning" anywhere: not among the cards, not in the chat.
  const cards = await page.evaluate(async () =>
    ((await (await fetch("/api/chat/cards")).json()).cards as { body: string }[]).map(
      (c) => c.body,
    ),
  );
  expect(cards.filter((b) => /^Good (morning|afternoon|evening)!/.test(b))).toEqual([]);
  await page.goto("/chat?embed=1");
  await expect(page.getByRole("textbox", { name: "Message Jane" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/^Good (morning|afternoon|evening)!/)).toHaveCount(0);
});

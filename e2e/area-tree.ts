import { expect, type Locator, type Page } from "@playwright/test";

// The area page pattern (docs/design/area-pages.md): open a branch of the area's tree, pick an
// item, and get the detail region (named after the branch) that opens for it.

export function areaTree(page: Page, name: string): Locator {
  return page.getByRole("tree", { name });
}

// A node to the middle of the screen before a tap, clear of the floating cards and the Jane
// button at the bottom of a phone.
async function tap(node: Locator) {
  // A timeout, so a retry can open the branch again when a reload closed it.
  await node.evaluate((el) => el.scrollIntoView({ block: "center" }), undefined, {
    timeout: 5_000,
  });
  await node.click({ timeout: 5_000 });
}

export async function openBranch(page: Page, tree: string, branch: string | RegExp) {
  const node = areaTree(page, tree)
    .locator('[role="treeitem"][aria-level="2"]')
    .filter({ hasText: branch })
    .first();
  // With another branch open, the branches can be off to the left of the view.
  const back = page.getByRole("button", { name: /^All of / });
  await expect(async () => {
    if ((await node.getAttribute("aria-expanded")) !== "true") {
      if (await back.isVisible()) await back.click();
      await tap(node);
    }
    await expect(node).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return node;
}

// Picks an item by its text, or the first one needing attention when `item` is "first-open".
// Retried until it sticks: after a form posts, the page comes back and may reset the tree.
export async function pickItem(
  page: Page,
  tree: string,
  branch: string,
  item: string | RegExp | "first-open",
): Promise<Locator> {
  const items = areaTree(page, tree).locator('[role="treeitem"][aria-level="3"]');
  const node =
    item === "first-open"
      ? items.filter({ has: page.locator('[data-status="look"], [data-status="act"]') }).first()
      : items.filter({ hasText: item }).first();
  await expect(async () => {
    await openBranch(page, tree, branch);
    await tap(node);
    await expect(node).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  return page.getByRole("region", { name: branch });
}

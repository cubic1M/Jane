import { expect, test, type Page, type Request } from "@playwright/test";
import { E2E_DATABASE_URL, deleteUser, signedInUser } from "./db";
import { demoPerson } from "./demo-person";

// Switching tabs is seamless (founder 11-12: "preload the unused pages in the back so users can
// seamlessly switch tabs"): every top-bar tab opens from the browser's memory, with no trip to the
// server, after the first page, after a chat message, after a Yes on a card and after the tab was
// out of sight (src/lib/page-cache.ts). Preloading only runs on a production build.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.skip(process.env.E2E_PROD !== "1", "preloading only runs on a production build");
test.setTimeout(240_000);

const created: string[] = [];
test.afterEach(async () => {
  for (const id of created.splice(0)) await deleteUser(id);
});

const TABS = ["/money", "/insurance", "/loans", "/taxes", "/investments", "/ahead"];

const pageData = (r: Request) =>
  !!r.headers()["rsc"] &&
  !r.headers()["next-router-prefetch"] &&
  !r.headers()["next-router-segment-prefetch"];

// The pages fetched from the server from now on, in the order asked, and which of those requests
// have fully arrived.
function watch(page: Page) {
  const started: string[] = [];
  const requests: Request[] = [];
  const arrived = new Set<Request>();
  page.on("request", (r) => {
    if (!pageData(r)) return;
    started.push(new URL(r.url()).pathname);
    requests.push(r);
  });
  // The router cancels a preload's stream once it has read the end of it.
  const ended = (r: Request) => {
    if (pageData(r)) arrived.add(r);
  };
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  return { started, requests, arrived };
}

async function settled(page: Page) {
  await page.locator("#app-top-bar").waitFor({ state: "attached", timeout: 60_000 });
  await expect(
    page.locator("main [data-loading-bar],[data-header-loading],[data-nav-pending]"),
  ).toHaveCount(0, { timeout: 60_000 });
}

// The tabs are back in memory: each was asked for again after request number `from`, and that
// request has arrived. A preload asked for before (still arriving when a Yes emptied the memory)
// doesn't count.
async function tabsInMemory(net: ReturnType<typeof watch>, from: number, here: string) {
  const back = (tab: string) =>
    net.requests.slice(from).some((r) => new URL(r.url()).pathname === tab && net.arrived.has(r));
  for (const tab of TABS.filter((t) => t !== here)) {
    await expect.poll(() => back(tab), { timeout: 60_000 }).toBe(true);
  }
}

// Every tab, one after another: none goes to the server.
async function everyTabFromMemory(page: Page, net: ReturnType<typeof watch>) {
  for (const tab of TABS) {
    const before = net.started.length;
    const link = page.locator(`#main-nav a[href="${tab}"]`);
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page).toHaveURL(tab);
    await settled(page);
    expect(net.started.slice(before), `${tab} went to the server`).not.toContain(tab);
  }
}

test("after the first page, a chat message, and the tab coming back, every tab is in memory", async ({
  context,
  page,
  baseURL,
}) => {
  const user = await signedInUser("user");
  created.push(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  await page.clock.install();
  const net = watch(page);
  await page.goto("/insurance");
  await settled(page);
  await tabsInMemory(net, 0, "/insurance");
  await everyTabFromMemory(page, net);

  // A chat message (the side chat's frame posts the same and tells this window).
  await page.evaluate(async () => {
    const reply = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    await reply.text();
  });
  await everyTabFromMemory(page, net);

  // Out of sight for ten minutes, then back.
  const visibility = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
      Object.defineProperty(document, "visibilityState", {
        value: hidden ? "hidden" : "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await visibility(true);
  await page.clock.fastForward("10:00");
  await visibility(false);
  await everyTabFromMemory(page, net);
});

test("after a Yes on a card, the tabs come back fresh and open from memory", async ({
  context,
  page,
  baseURL,
}) => {
  created.push(await demoPerson(context, page, baseURL));
  await page.goto("/plan");
  await settled(page);
  const net = watch(page);
  const yes = page
    .locator("[data-plan-item]")
    .first()
    .getByRole("button", { name: /^Yes\b/ });
  const answered = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/plan",
  );
  await yes.click();
  await (await answered).finished();
  // Every page was made again after the Yes (no old numbers), then kept.
  await tabsInMemory(net, net.requests.length, "/plan");
  await everyTabFromMemory(page, net);
});

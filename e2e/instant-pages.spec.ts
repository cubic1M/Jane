import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL, deleteUser, setCheckingBalance, signedInUser } from "./db";
import { demoPerson } from "./demo-person";
import { holds } from "./waits";

// Moving between pages (src/lib/page-cache.ts; founder: "cache the pages so you go to a page you
// returned it's already done loading ... the other background pages are loading secretly ... Only
// show loading bar when it's not done loading"). Prefetching only runs on a production build.

test.skip(!E2E_DATABASE_URL, "needs E2E_DATABASE_URL pointing at a scratch database");
test.skip(process.env.E2E_PROD !== "1", "prefetching only runs on a production build");
test.setTimeout(180_000);

const created: string[] = [];
test.afterEach(async () => {
  for (const id of created.splice(0)) await deleteUser(id);
});

async function person(context: BrowserContext, baseURL: string | undefined) {
  const user = await signedInUser("user");
  created.push(user.userId);
  await context.addCookies([
    { name: "authjs.session-token", value: user.sessionToken, url: baseURL ?? "" },
  ]);
  return user;
}

const SETTLED = "main [data-loading-bar],[data-header-loading],[data-nav-pending]";

// The whole page has arrived.
async function settled(page: Page) {
  await page.locator("#app-top-bar").waitFor({ state: "attached", timeout: 60_000 });
  await expect(page.locator(SETTLED)).toHaveCount(0, { timeout: 60_000 });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await settled(page);
}

const pageData = (request: Request) =>
  !!request.headers()["rsc"] &&
  !request.headers()["next-router-prefetch"] &&
  !request.headers()["next-router-segment-prefetch"];

// The pages fetched from the server, from now on, finished or not.
function fetched(page: Page) {
  const started: string[] = [];
  const finished: string[] = [];
  page.on("request", (r) => {
    if (pageData(r)) started.push(new URL(r.url()).pathname);
  });
  const ended = (r: Request) => {
    if (pageData(r)) finished.push(new URL(r.url()).pathname);
  };
  page.on("requestfinished", ended);
  // The router cancels a preload's stream once it has read the end of it.
  page.on("requestfailed", ended);
  return { started, finished };
}

// A bar on screen at any moment from here on (src/components/nav-pending.tsx and a page's own).
async function watchForBar(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { barSeen: boolean; barWatch?: boolean };
    w.barSeen = false;
    if (w.barWatch) return;
    w.barWatch = true;
    const look = () => {
      const bars = document.querySelectorAll(
        "main [data-loading-bar],#page-loading [data-loading-bar]",
      );
      for (const bar of bars) if (getComputedStyle(bar).visibility === "visible") w.barSeen = true;
      requestAnimationFrame(look);
    };
    look();
  });
}
const barSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { barSeen: boolean }).barSeen);

async function tab(page: Page, path: string) {
  const link = page.locator(`#main-nav a[href="${path}"]`);
  await link.scrollIntoViewIfNeeded();
  await link.click({ noWaitAfter: true });
  await expect(page).toHaveURL(path);
  await settled(page);
}

async function rowCount(sql: string, values: unknown[]): Promise<number> {
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return Number((await client.query(sql, values)).rows[0].n);
  } finally {
    await client.end();
  }
}

// A page with no link to it from here, as a person's click on a link would.
const push = (page: Page, path: string) =>
  page.evaluate((to) => {
    (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to);
  }, path);

// Set on the window: only a full page load, which empties the router's memory, takes it away.
const mark = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { kept: number }).kept = 1;
  });
const stillMarked = (page: Page) =>
  page.evaluate(() => (window as unknown as { kept?: number }).kept === 1);

test.describe("coming back to a page", () => {
  test("is there at once, with no bar and no trip to the server", async ({
    context,
    page,
    baseURL,
  }) => {
    await person(context, baseURL);
    await open(page, "/insurance");
    await tab(page, "/taxes");
    const pages = fetched(page);
    await watchForBar(page);
    await tab(page, "/insurance");
    expect(pages.started).not.toContain("/insurance");
    expect(await barSeen(page)).toBe(false);
  });

  test("refreshes quietly when the page is old", async ({ context, page, baseURL }) => {
    await person(context, baseURL);
    await page.clock.install();
    await open(page, "/insurance");
    await tab(page, "/taxes");
    await page.clock.fastForward("06:00");
    const pages = fetched(page);
    await watchForBar(page);
    await tab(page, "/insurance");
    await expect.poll(() => pages.started).toContain("/insurance");
    expect(await barSeen(page)).toBe(false);
  });
});

test("a page that must always be fresh never comes from memory", async ({
  context,
  page,
  baseURL,
}) => {
  await person(context, baseURL);
  await open(page, "/insurance");
  await push(page, "/jane");
  await expect(page).toHaveURL("/jane");
  await settled(page);
  await tab(page, "/insurance");
  const pages = fetched(page);
  await push(page, "/jane");
  await expect(page).toHaveURL("/jane");
  await settled(page);
  expect(pages.started).toContain("/jane");
});

test.describe("the pages loaded ahead of time", () => {
  test("open at once the first time, with no bar and no trip to the server", async ({
    context,
    page,
    baseURL,
  }) => {
    await person(context, baseURL);
    const pages = fetched(page);
    await open(page, "/insurance");
    await expect.poll(() => pages.finished, { timeout: 60_000 }).toContain("/taxes");
    const before = pages.started.length;
    await watchForBar(page);
    await tab(page, "/taxes");
    expect(pages.started.slice(before)).not.toContain("/taxes");
    expect(await barSeen(page)).toBe(false);
  });

  test("count as nobody's view: no view event, no activity, until the page is opened", async ({
    context,
    page,
    baseURL,
  }) => {
    const { userId } = await person(context, baseURL);
    const pages = fetched(page);
    await open(page, "/insurance");
    await expect.poll(() => pages.finished, { timeout: 60_000 }).toContain("/report");
    const views = (name: string) =>
      rowCount("SELECT count(*) AS n FROM analytics_events WHERE user_id = $1 AND name = $2", [
        userId,
        name,
      ]);
    const activity = (path: string) =>
      rowCount(
        "SELECT count(*) AS n FROM activity_events WHERE user_id = $1 AND kind = 'page_view' AND path = $2",
        [userId, path],
      );
    await holds(async () => {
      for (const name of ["taxes_viewed", "loans_viewed", "plan_viewed", "report_viewed"]) {
        expect(await views(name)).toBe(0);
      }
      expect(await activity("/taxes")).toBe(0);
    }, 1_500);

    // Really opened, from memory: that's a view.
    await tab(page, "/taxes");
    await expect.poll(() => views("taxes_viewed")).toBe(1);
  });

  test("leave what only opening a page does, until the page is opened", async ({
    context,
    page,
    baseURL,
  }) => {
    await person(context, baseURL);
    const opened: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/opened") opened.push(r.postData() ?? "");
    });
    const pages = fetched(page);
    await open(page, "/insurance");
    await expect.poll(() => pages.finished, { timeout: 60_000 }).toContain("/investments");
    await holds(() => expect(opened).toEqual([]), 1_500);

    await tab(page, "/investments");
    await expect.poll(() => opened).toEqual([JSON.stringify({ page: "investments" })]);
  });

  for (const [name, connection] of [
    ["Save-Data on", { saveData: true, effectiveType: "4g" }],
    ["a slow connection", { effectiveType: "3g" }],
  ] as const) {
    test(`never run with ${name}`, async ({ context, page, baseURL }) => {
      await person(context, baseURL);
      await context.addInitScript((value) => {
        Object.defineProperty(navigator, "connection", { value, configurable: true });
      }, connection);
      const pages = fetched(page);
      await open(page, "/insurance");
      await holds(() => expect(pages.started).toEqual([]), 4_000);
    });
  }
});

test.describe("the loading bar", () => {
  test("shows when a page truly isn't ready", async ({ context, page, baseURL }) => {
    await person(context, baseURL);
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true },
        configurable: true,
      });
    });
    await open(page, "/insurance");
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/taxes**", async (route) => {
      await held;
      await route.continue();
    });
    await page.locator('#main-nav a[href="/taxes"]').click({ noWaitAfter: true });
    await expect(page.locator("[data-nav-pending] [data-loading-bar]")).toBeVisible();
    release();
    await expect(page).toHaveURL("/taxes");
    await settled(page);
  });

  test("of a part still arriving stays out of sight for a moment, so it can't flash", async ({
    context,
    page,
    baseURL,
  }) => {
    await person(context, baseURL);
    await open(page, "/insurance");
    const shown = await page.evaluate(async () => {
      const bar = document.createElement("div");
      bar.setAttribute("data-loading-bar", "");
      bar.textContent = "Loading";
      document.querySelector("main")!.append(bar);
      const first = getComputedStyle(bar).visibility;
      await new Promise((resolve) => setTimeout(resolve, 300));
      const later = getComputedStyle(bar).visibility;
      bar.remove();
      return { first, later };
    });
    expect(shown).toEqual({ first: "hidden", later: "visible" });
  });
});

test.describe("one person's pages never show to another", () => {
  const menu = (page: Page) => page.getByRole("button", { name: "Your account and settings" });

  test("signing out empties the memory, and Back shows nothing of theirs", async ({
    context,
    page,
    baseURL,
  }) => {
    await person(context, baseURL);
    await open(page, "/insurance");
    await tab(page, "/taxes");
    await mark(page);
    await menu(page).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");
    await expect.poll(() => stillMarked(page).catch(() => true)).toBe(false);

    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("#app-top-bar")).toHaveCount(0);
  });

  test("another tab signing out empties this one too", async ({ context, page, baseURL }) => {
    await person(context, baseURL);
    await open(page, "/insurance");
    await tab(page, "/taxes");
    await mark(page);

    const other = await context.newPage();
    await open(other, "/insurance");
    await menu(other).click();
    await other.getByRole("button", { name: "Sign out" }).click();
    await expect(other).toHaveURL("/");

    await expect(page).toHaveURL(/\/login/);
    expect(await stillMarked(page)).toBe(false);
  });

  test("someone else signing in, in another tab, empties this one", async ({
    context,
    page,
    baseURL,
  }) => {
    await person(context, baseURL);
    await open(page, "/insurance");
    await tab(page, "/taxes");
    await mark(page);

    const next = await signedInUser("user");
    created.push(next.userId);
    await context.addCookies([
      { name: "authjs.session-token", value: next.sessionToken, url: baseURL ?? "" },
    ]);
    const other = await context.newPage();
    await open(other, "/insurance");

    await expect.poll(() => stillMarked(page).catch(() => true)).toBe(false);
    await settled(page);
    await menu(page).click();
    await expect(page.getByText(`${next.userId}@example.test`)).toBeVisible();
  });

  test("deleting the account empties the memory", async ({ context, page, baseURL }) => {
    await person(context, baseURL);
    await open(page, "/insurance");
    await tab(page, "/taxes");
    await push(page, "/settings#delete");
    await expect(page).toHaveURL(/\/settings/);
    await settled(page);
    await mark(page);
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete all my data" }).click();
    await expect(page.getByRole("heading", { name: "Your data is deleted" })).toBeVisible();
    await expect.poll(() => stillMarked(page).catch(() => true)).toBe(false);
  });
});

test.describe("what a person has seen", () => {
  test("hidden figures start hidden on every return, from memory or by Back", async ({
    context,
    page,
    baseURL,
  }) => {
    created.push(await demoPerson(context, page, baseURL));
    await open(page, "/home");
    const netWorth = page.locator('[data-net-worth-chart] [data-hub-number="net-worth"]');
    const show = page
      .locator("[data-net-worth-chart]")
      .getByRole("button", { name: /SHOW VALUE.* of net worth/ });
    const hidden = async () => {
      await expect(netWorth).toContainText("*****");
      for (const number of ["net-worth", "safe", "saved"]) {
        await expect(page.locator(`[data-hub-number="${number}"]`).first()).not.toContainText("$");
      }
    };
    await hidden();
    await show.click();
    await expect(netWorth).toHaveText(/\$[\d,]+/);

    // Back by the tab, from memory: no trip to the server.
    await tab(page, "/money");
    const pages = fetched(page);
    await tab(page, "/home");
    expect(pages.started).not.toContain("/home");
    await hidden();

    // Shown again, and back by the browser's button.
    await show.click();
    await expect(netWorth).toHaveText(/\$[\d,]+/);
    await tab(page, "/money");
    await page.goBack();
    await expect(page).toHaveURL("/home");
    await hidden();
  });

  // Shows Home's net worth and says what it is.
  async function shownNetWorth(page: Page) {
    const chart = page.locator("[data-net-worth-chart]");
    await chart.getByRole("button", { name: /SHOW VALUE.* of net worth/ }).click();
    const figure = chart.locator('[data-hub-number="net-worth"]');
    await expect(figure).toHaveText(/\$[\d,]+/);
    return { figure, text: await figure.innerText() };
  }

  // A Yes on the plan's first card, until the server has answered it.
  async function yesOnThePlan(page: Page) {
    const yes = page
      .locator("[data-plan-item]")
      .first()
      .getByRole("button", { name: /^Yes\b/ });
    const answered = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/plan",
    );
    await yes.click();
    await (await answered).finished();
  }

  test("after a Yes, no page shows the old numbers; before it, the page comes from memory", async ({
    context,
    page,
    baseURL,
  }) => {
    const userId = await demoPerson(context, page, baseURL);
    created.push(userId);
    await open(page, "/home");
    const { text: old } = await shownNetWorth(page);

    // The money moves on the server. Nothing has told this browser, so the page it kept is the same.
    await setCheckingBalance(userId, 123_456_00);
    await tab(page, "/money");
    await tab(page, "/home");
    expect((await shownNetWorth(page)).text).toBe(old);

    await push(page, "/plan");
    await expect(page).toHaveURL("/plan");
    await settled(page);
    await yesOnThePlan(page);

    // Every page from here on is the new one.
    await tab(page, "/home");
    const { figure } = await shownNetWorth(page);
    await expect(figure).not.toHaveText(old);
  });

  test("a Yes in another tab reaches this one", async ({ context, page, baseURL }) => {
    const userId = await demoPerson(context, page, baseURL);
    created.push(userId);
    await open(page, "/home");
    const { text: old } = await shownNetWorth(page);
    await tab(page, "/money");
    await setCheckingBalance(userId, 123_456_00);

    const other = await context.newPage();
    await open(other, "/plan");
    await yesOnThePlan(other);
    await other.close();

    await page.bringToFront();
    await tab(page, "/home");
    const { figure } = await shownNetWorth(page);
    await expect(figure).not.toHaveText(old);
  });
});

// Debugger 11-05: "Link a demo bank", the scan, then back on /connect for good. Home, with no bank yet,
// sends someone to /connect. A first round of preloads that started on the scan's page kept that answer
// for the hand-off. Forced without touching the database (the suite shares it): the round can't start
// until the click, and the scan's page stays up while we watch for it.
test("the first scan's page starts no preloads", async ({ context, page, baseURL }) => {
  await person(context, baseURL);
  let clicked: () => void = () => {};
  const afterClick = new Promise<void>((resolve) => (clicked = resolve));
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    const answer = await route.fetch();
    if ((await answer.text()).includes("jane:page-cache")) await afterClick;
    await route.fulfill({ response: answer }).catch(() => undefined);
  });
  let scanRunning = true;
  await page.route("**/api/detection/status", (route) =>
    scanRunning ? route.fulfill({ json: {} }) : route.continue(),
  );
  const askedForHome: string[] = [];
  page.on("request", (request) => {
    if (/\/home\?_rsc=/.test(request.url()) && /\/scanning/.test(page.url()))
      askedForHome.push(request.url());
  });

  // Not "load": the script held above could be what the page's load is waiting on.
  await page.goto("/connect", { waitUntil: "commit" });
  await page.getByRole("button", { name: "Link a demo bank" }).click();
  // Not its load either: that waits on the same held script, which only goes after this.
  await page.waitForURL(/\/scanning/, { timeout: 60_000, waitUntil: "commit" });
  clicked();
  await holds(() => expect(askedForHome).toEqual([]), 4_000);

  scanRunning = false;
  await expect(page).toHaveURL(/\/home(\?|$)/, { timeout: 90_000 });
  // A script still being fetched here would throw once the test has ended, and fail the run.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

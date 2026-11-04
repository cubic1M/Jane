import { expect, test, type Page } from "@playwright/test";
import { findingLinks, pageText, personWithStatement, visit } from "./person";
import { chaseChecking, monthly, ordinaryLife, type Row } from "./statements";

const MARK = "__holdoutRan";
const SCRIPT_ROW = `<script>window.${MARK}=1</script>LANTERN CLUB`;
const OTHER_HOSTILE_ROWS = [
  `<img src=x onerror="window.${MARK}=2">HARBOR GYM`,
  `"><svg onload=window.${MARK}=3>QUILL BOOKS`,
  `<b>BOLD MART</b>`,
  `<a href="javascript:window.${MARK}=4">TIDE LAUNDRY</a>`,
];

function hostile(descriptions: string[]): Row[] {
  return descriptions.flatMap((description, i) => monthly(description, -(1100 + i * 137)));
}

/** A long ordinary history, for a row far down a file. */
function longHistory(): Row[] {
  return Array.from({ length: 600 }, (_, i) => ({
    daysAgo: 2 + (i % 160),
    description: `CORNER GROCERY STORE ${String(i).padStart(3, "0")}`,
    cents: -(1000 + (i % 50) * 100),
  }));
}

/** What the page built from those rows: anything but text means the statement wrote the page. */
async function builtFromStatement(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((mark) => {
    const scripts = [...document.scripts].filter((s) =>
      (s.textContent ?? "").trim().startsWith(`window.${mark}`),
    );
    const all = [...document.querySelectorAll("*")];
    return {
      ran: (window as unknown as Record<string, unknown>)[mark] ?? null,
      scripts: scripts.length,
      eventAttributes: all.filter((el) =>
        [...el.attributes].some((a) => /^on/i.test(a.name) && a.value.includes(mark)),
      ).length,
      badImages: document.querySelectorAll('img[src="x"]').length,
      boldMart: [...document.querySelectorAll("b")].filter((b) => /bold mart/i.test(b.innerText))
        .length,
      scriptLinks: document.querySelectorAll('a[href^="javascript:"]').length,
    };
  }, MARK);
}

const NOTHING_BUILT = {
  ran: null,
  scripts: 0,
  eventAttributes: 0,
  badImages: 0,
  boldMart: 0,
  scriptLinks: 0,
};

async function expectNothingBuiltAnywhere(page: Page): Promise<void> {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const findings = await findingLinks(page);
  for (const path of [
    "/report",
    "/home",
    "/transactions",
    "/subscriptions",
    "/money",
    "/insights",
    ...findings,
  ]) {
    await visit(page, path);
    expect(await builtFromStatement(page), `${path} built nothing from the statement`).toEqual(
      NOTHING_BUILT,
    );
  }
  expect(dialogs).toEqual([]);
}

test.describe("A statement row holding HTML", () => {
  test("image, svg, bold and link tags show as words and do nothing", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...hostile(OTHER_HOSTILE_ROWS)]),
    );

    await expectNothingBuiltAnywhere(page);

    await visit(page, "/transactions");
    const list = await pageText(page);
    for (const words of [/harbor gym/i, /quill books/i, /bold mart/i, /tide laundry/i]) {
      expect(list).toMatch(words);
    }

    await context.close();
  });

  test("a script tag among the first rows: the statement is still read, as words", async ({
    browser,
    baseURL,
  }) => {
    // A bank statement with one odd row is still a bank statement.
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...hostile([SCRIPT_ROW])]),
    );

    await expectNothingBuiltAnywhere(page);

    await visit(page, "/transactions");
    expect(await pageText(page)).toMatch(/lantern club/i);

    await context.close();
  });

  test("a script tag far down a long file does nothing either", async ({ browser, baseURL }) => {
    const { context, page } = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([
        ...longHistory(),
        { daysAgo: 170, description: SCRIPT_ROW, cents: -2137 },
        { daysAgo: 171, description: OTHER_HOSTILE_ROWS[0], cents: -1137 },
      ]),
    );

    await expectNothingBuiltAnywhere(page);

    const search = await context.request.get("/api/export");
    expect(await search.text(), "the row was read").toMatch(/lantern club/i);

    await context.close();
  });
});

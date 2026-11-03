import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import { exportText, personWithSampleData, personWithStatement, visit } from "./person";
import { chaseChecking, monthly, ordinaryLife } from "./statements";

const SECRET_NAME = /token|secret|password|cipher|credential|private.?key/i;
const SECRET_VALUE = /access-(sandbox|development|production)-[0-9a-f-]{8,}/i;

/** Every field in the export with a value, whose name says it holds a secret. */
function secretFields(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => secretFields(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => {
      const here = path ? `${path}.${key}` : key;
      const named = SECRET_NAME.test(key) && inner !== null && inner !== undefined ? [here] : [];
      return [...named, ...secretFields(inner, here)];
    });
  }
  return [];
}

async function sessionCookieValues(context: BrowserContext): Promise<string[]> {
  const cookies = await context.cookies();
  return cookies.filter((c) => /session/i.test(c.name)).map((c) => c.value);
}

test.describe("Download my data", () => {
  test("holds the person's own statement and no one else's, from the link in Settings", async ({
    browser,
    baseURL,
  }) => {
    const other = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...monthly("SPOTIFY USA", -1199)]),
    );
    const person = await personWithStatement(
      browser,
      baseURL!,
      chaseChecking([...ordinaryLife(), ...monthly("NETFLIX.COM", -1549)]),
    );

    // The way a person gets it.
    await visit(person.page, "/settings");
    await person.page.getByText("Your data", { exact: false }).first().click();
    await person.page.getByText("Download my data").first().click();
    const waiting = person.page.waitForEvent("download");
    await person.page.locator('a[href="/api/export"]').click();
    const download = await waiting;
    const text = await readFile(await download.path(), "utf8");
    const data: unknown = JSON.parse(text);

    // Their own rows, all six charges, with the amount.
    expect(text.match(/NETFLIX\.COM/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(text).toContain("1549");
    expect(text).toContain("MAPLE COURT APARTMENTS RENT");
    expect(text).toContain("NORTHWIND TOOLS PAYROLL PPD");

    // Nobody else's.
    expect(text).not.toMatch(/spotify/i);

    // Nothing that would let someone in.
    expect(secretFields(data)).toEqual([]);
    expect(text).not.toMatch(SECRET_VALUE);
    for (const cookie of await sessionCookieValues(person.context)) {
      expect(text).not.toContain(cookie);
    }

    await Promise.all([other.context.close(), person.context.close()]);
  });

  test("for someone with a linked bank, it lists the bank and holds no bank token", async ({
    browser,
    baseURL,
  }) => {
    const person = await personWithSampleData(browser, baseURL!);
    const text = await exportText(person.context);
    const data = JSON.parse(text) as { banks: unknown[]; transactions: unknown[] };

    // Without this the check below would be empty: there is a linked bank here to leak.
    expect(data.banks.length, "the sample person has a linked bank").toBeGreaterThan(0);
    expect(data.transactions.length).toBeGreaterThan(0);

    expect(secretFields(data)).toEqual([]);
    expect(text).not.toMatch(SECRET_VALUE);
    for (const cookie of await sessionCookieValues(person.context)) {
      expect(text).not.toContain(cookie);
    }

    await person.context.close();
  });
});

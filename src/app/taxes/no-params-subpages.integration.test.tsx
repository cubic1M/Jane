import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Tax T32b: the sub-pages under /taxes and /what-if call the loaders directly (a layout guard would
// make the layout dynamic and break the instant-loading shell), so each page catches a year without
// IRS figures itself and says the W-N sentence instead of showing the error page. 2028 truly has no
// parameters; the frozen clock is February 10, 2029, when the usual tax year (last year until the end
// of April) and the filing year are both 2028. The person is a demo-bank freelancer made on
// 2026-11-05, so the loaders have accounts to read and reach the year's figures.
const who = vi.hoisted(() => ({ id: "", email: "no-params-subpages@example.test" }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: async () => who }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));
vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: ReactNode }) => children,
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { saveMiles } from "@/lib/self-employed";

const url = process.env.TEST_DATABASE_URL;
const CREATED = new Date("2029-01-20T23:00:00Z");
const NOW = new Date("2029-02-10T18:00:00Z");
const sentence = (year: number) =>
  `Jane doesn&#x27;t have the IRS figures for ${year} yet, so it isn&#x27;t estimating that year.`;

// The async server component a page wraps (the page itself is a shell with a Suspense around it).
function content(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = content(child);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const type = node.type as unknown;
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") return node;
  return content((node.props as { children?: ReactNode }).children);
}

async function html(
  load: () => Promise<{ default: (props: never) => ReactNode }>,
  props: object = {},
): Promise<string> {
  const { default: Page } = await load();
  const inner = content(Page(props as never));
  if (!inner) throw new Error("no async content in the page");
  const body = await (inner.type as (p: unknown) => Promise<ReactElement>)(inner.props);
  return renderToStaticMarkup(body);
}

// Every page below /taxes and /what-if. `year` is the year its sentence names when it prices one: the
// tax year (2028, last year until the end of April) or, for the health and retirement pages, the
// calendar year (2029). null: the page reads no year's figures at this person and date (the
// filing page shows no estimate, disasters shows the relief feed, what-if tolerates a missing
// tax rate), so it must only render.
const PAGES: {
  name: string;
  load: () => Promise<never>;
  props?: object;
  year: number | null;
}[] = [
  { name: "accountant", load: () => import("./accountant/page") as never, year: 2028 },
  { name: "business", load: () => import("./business/page") as never, year: 2028 },
  { name: "calendar", load: () => import("./calendar/page") as never, year: 2028 },
  { name: "disasters", load: () => import("./disasters/page") as never, year: null },
  { name: "draft", load: () => import("./draft/page") as never, year: null },
  { name: "equity", load: () => import("./equity/page") as never, year: 2028 },
  { name: "file", load: () => import("./file/page") as never, year: null },
  { name: "health", load: () => import("./health/page") as never, year: 2029 },
  { name: "identity", load: () => import("./identity/page") as never, year: null },
  { name: "inherited", load: () => import("./inherited/page") as never, year: 2028 },
  { name: "last-return", load: () => import("./last-return/page") as never, year: null },
  { name: "letters", load: () => import("./letters/page") as never, year: null },
  { name: "profile", load: () => import("./profile/page") as never, year: null },
  { name: "property", load: () => import("./property/page") as never, year: 2028 },
  { name: "retirement", load: () => import("./retirement/page") as never, year: 2029 },
  { name: "self-employed", load: () => import("./self-employed/page") as never, year: 2028 },
  {
    name: "tags",
    load: () => import("./tags/page") as never,
    props: { searchParams: Promise.resolve({}) },
    year: null,
  },
  { name: "years", load: () => import("./years/page") as never, year: 2028 },
  {
    name: "what-if",
    load: () => import("../what-if/page") as never,
    props: { searchParams: Promise.resolve({ s: "job_loss" }) },
    year: null,
  },
];

describe.runIf(url)("a year with no IRS figures, on every sub-page", { timeout: 120_000 }, () => {
  let client: PrismaClient;

  beforeAll(async () => {
    stubTestKeys();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    who.id = await createCheckPerson({ client, now: CREATED, person: "freelancer" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterAll(async () => {
    vi.useRealTimers();
    if (who.id) await deleteCheckPerson(who.id, { client }).catch(() => {});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PAGES)("$name renders, and says the sentence when it prices a year", async (page) => {
    const out = await html(page.load, page.props);
    if (page.year !== null) {
      expect(out).toContain(sentence(page.year));
      // The sentence stands where the figures were: no dollar figure on the page.
      expect(out).not.toMatch(/\$\d/);
    }
  });
});

// 2027 has every figure but the IRS mileage rate: its pages price normally and only the miles say
// they are not counted (the W-N sentence for the rate, no dollar figure for them).
describe.runIf(url)("2027 on the freelance and business pages", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const MILEAGE_W_N =
    "Jane doesn&#x27;t have the IRS&#x27;s 2027 mileage rate yet, so it hasn&#x27;t counted those miles.";

  beforeAll(async () => {
    stubTestKeys();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    who.id = await createCheckPerson({
      client,
      now: new Date("2027-04-25T18:00:00Z"),
      person: "freelancer",
    });
    await saveMiles(who.id, 1_200, { client, now: new Date("2027-05-01T18:00:00Z"), via: "page" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-05-02T18:00:00Z"));
  });
  afterAll(async () => {
    vi.useRealTimers();
    if (who.id) await deleteCheckPerson(who.id, { client }).catch(() => {});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("/taxes/self-employed shows the year's figures and the sentence instead of the miles figure", async () => {
    const out = await html(() => import("./self-employed/page") as never);
    expect(out).toContain("Freelance taxes: 2027");
    expect(out).toContain("Miles driven for this work in 2027.");
    expect(out).toContain(MILEAGE_W_N);
    expect(out).not.toContain("cents a mile");
    expect(out).not.toContain(sentence(2027));
  });

  it("/taxes/business shows the miles without a deduction", async () => {
    const out = await html(() => import("./business/page") as never);
    expect(out).not.toContain(sentence(2027));
    // The qualified business income deduction and the S corporation comparison are priced as usual.
    expect(out).toContain("Your qualified business income deduction is about $");
    expect(out).toContain(`Business miles: 1200. ${MILEAGE_W_N}`);
    expect(out).not.toMatch(/Business miles: 1200, a/);
  });
});

// A new sub-page is a failing test until it is listed above: the list is what keeps the sentence
// and the error page from coming back.
describe("the list of sub-pages", () => {
  it("names every page.tsx under /taxes (but the Taxes page itself) and /what-if", () => {
    const found = readdirSync(__dirname, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(__dirname, d.name, "page.tsx")))
      .map((d) => d.name);
    expect([...found, "what-if"].sort()).toEqual(PAGES.map((p) => p.name).sort());
  });
});

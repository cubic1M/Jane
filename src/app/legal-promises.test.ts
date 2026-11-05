import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A read of every promise against the code. The filter on health and the like only covers what
// Jane remembers; a medical bill is still a transaction. Sign-in records outlive a deletion for 400
// days, with address and rough location, and a failed attempt isn't tied to an account, so nobody
// sees "their own". Words that say more than the code does are worse than saying less.
const page = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

describe("what the pages promise", () => {
  const privacy = page("src/app/privacy/page.tsx");
  const security = page("src/app/security/page.tsx");
  const connect = page("src/app/connect/link-choice.tsx");

  it("doesn't say Jane keeps nothing about someone's health", () => {
    expect(privacy).not.toMatch(/Jane never keeps anything about your health/);
    expect(privacy).toMatch(/Your transactions, chats, documents and tax tags can still show/);
  });

  it("says sign-in records stay after a deletion", () => {
    expect(privacy).toMatch(/your sign-ins, two-factor changes and downloads/);
  });

  it("doesn't say every read is for one person", () => {
    expect(privacy).not.toMatch(/only ever read for that person/);
    expect(security).not.toMatch(/single, tested helper/);
  });

  it("doesn't offer someone their own failed attempts", () => {
    expect(security).toMatch(/apart from failed attempts/);
  });

  it("names what linking reads, and every company it goes to", () => {
    expect(connect).toMatch(/what you owe on cards and loans/);
    expect(privacy).toMatch(/<strong>Google<\/strong>/);
    expect(privacy).toMatch(/<strong>Sentry<\/strong>/);
  });
});

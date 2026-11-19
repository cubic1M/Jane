import { describe, expect, it } from "vitest";
import { allConnectors } from "./registry";

// The consent screen's "From" line (src/lib/connectors/connect.ts): a connector that reads a person's
// data says where it comes from, in words that aren't its name (the C8 fixture walk, 11-19, found it
// repeating the title on every twin). A connector that only acts says nothing there.
describe("where a read connector's data comes from", () => {
  const readers = allConnectors().filter((c) => c.capabilities.includes("read"));

  it("covers the read connectors", () => {
    expect(readers.length).toBeGreaterThan(0);
  });

  it.each(readers.map((c) => [c.id, c] as const))("%s names its source", (_id, connector) => {
    expect(connector.from?.trim()).toBeTruthy();
    expect(connector.from).not.toBe(connector.name);
  });

  it("says a sample twin's data is a sample", () => {
    for (const twin of readers.filter((c) => c.sandbox)) expect(twin.from).toMatch(/sample/i);
  });
});

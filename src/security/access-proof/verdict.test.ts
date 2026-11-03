import { describe as group, expect, it } from "vitest";
import type { Answer } from "./invoke";
import type { Write } from "./probe";
import { findMarker } from "./scan";
import { judge, type Observation } from "./verdict";

const victim = { userId: "alice", marker: "zqmarkzq" };
const seen = (overrides: Partial<Observation> & { answer: Answer }): Observation => ({
  access: "signed-in",
  attacker: "stranger",
  writes: [],
  traffic: { landed: false, markerRead: [], outbound: [] },
  victim,
  actorId: "bob",
  ...overrides,
});
const write = (over: Partial<Write>): Write => ({
  tbl: "accounts",
  op: "UPDATE",
  owner: null,
  old_owner: null,
  points_at: null,
  ...over,
});

group("what the attack calls a failure", () => {
  it("a marker anywhere in the answer, whatever its case", () => {
    const value = { body: JSON.stringify({ rows: [{ name: "Alice ZQMARKZQ" }] }) };
    expect(judge(seen({ answer: { name: "x", status: 200, value } }))[0]).toContain("leak");
  });

  it("a marker in a redirect, an error or an outgoing request, email included", () => {
    const answer: Answer = { name: "x", redirect: "/home?who=zqmarkzq" };
    expect(judge(seen({ answer })).join()).toContain("in a redirect");
    expect(
      judge(seen({ answer: { name: "x", threw: "m", value: new Error("no zqmarkzq") } })).join(),
    ).toContain("leak");
    expect(
      judge(
        seen({
          answer: { name: "x" },
          traffic: { landed: false, markerRead: [], outbound: ["https://x zqmarkzq"] },
        }),
      ).join(),
    ).toContain("left in");
  });

  it("writing to the victim's rows or moving them away, unless listed", () => {
    const answer: Answer = { name: "x", status: 200 };
    expect(judge(seen({ answer, writes: [write({ owner: "alice" })] })).join()).toContain("wrote");
    expect(
      judge(seen({ answer, writes: [write({ old_owner: "alice", owner: "bob" })] })).join(),
    ).toContain("wrote");
    expect(
      judge(seen({ answer, writes: [write({ owner: "alice" })], allowedWrites: ["accounts"] })),
    ).toEqual([]);
  });

  it("the attacker's own row pointing at the victim's", () => {
    const answer: Answer = { name: "x", status: 200 };
    const writes = [write({ owner: "bob", points_at: "account_id" })];
    expect(judge(seen({ answer, writes })).join()).toContain("linked");
  });

  it("nobody getting in, or a signed-in stranger reaching admin, cron or a webhook", () => {
    expect(
      judge(seen({ attacker: "nobody", answer: { name: "x", status: 200, value: {} } })).join(),
    ).toContain("not refused");
    expect(judge(seen({ access: "admin", answer: { name: "x", value: {} } })).join()).toContain(
      "not refused",
    );
    expect(judge(seen({ access: "cron", answer: { name: "x", status: 200 } })).join()).toContain(
      "not refused",
    );
    expect(judge(seen({ access: "webhook", answer: { name: "x", status: 200 } })).join()).toContain(
      "not refused",
    );
  });

  it("a trial person in analytics, or causing an email", () => {
    const answer: Answer = { name: "x", status: 200 };
    const writes = [write({ tbl: "analytics_events", owner: "bob" })];
    expect(judge(seen({ attacker: "trial", answer, writes })).join()).toContain("analytics");
    const traffic = {
      landed: false,
      markerRead: [],
      outbound: ["https://api.resend.com/emails {}"],
    };
    expect(judge(seen({ attacker: "trial", answer, traffic })).join()).toContain("email");
  });
});

group("what it doesn't", () => {
  it("being told no, sent to sign in, or a stranger getting their own data", () => {
    for (const answer of [
      { name: "x", status: 401 },
      { name: "x", status: 404 },
      { name: "x", redirect: "/login" },
      { name: "x", redirect: "http://localhost:3000/mfa?next=/home" },
    ]) {
      expect(judge(seen({ attacker: "nobody", answer }))).toEqual([]);
    }
    expect(judge(seen({ answer: { name: "x", status: 200, value: { own: "data" } } }))).toEqual([]);
  });

  it("a public page answering anyone", () => {
    expect(
      judge(seen({ access: "public", attacker: "nobody", answer: { name: "x", status: 200 } })),
    ).toEqual([]);
  });
});

group("findMarker", () => {
  it("looks through nested values, maps, sets, keys and errors", () => {
    expect(findMarker({ a: [{ b: "x zqm" }] }, "ZQM")).toBe("response.a[0].b");
    expect(findMarker(new Map([["k", "zqm"]]), "zqm")).toBeTruthy();
    expect(findMarker(new Set(["zqm"]), "zqm")).toBeTruthy();
    expect(findMarker({ zqm: 1 }, "zqm")).toBeTruthy();
    expect(findMarker(new Error("zqm"), "zqm")).toBeTruthy();
    expect(findMarker({ safe: 1, when: new Date(0) }, "zqm")).toBeNull();
  });

  it("survives a loop", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(findMarker(loop, "zqm")).toBeNull();
  });
});

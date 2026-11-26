import net from "node:net";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { installProbes, seen } from "./probe";
import { resolveTree } from "./render";
import { judge, type Observation } from "./verdict";

const victim = { userId: "alice", marker: "zqmarkzq" };
const observed = (over: Partial<Observation>): Observation => ({
  access: "admin",
  attacker: "stranger",
  answer: { name: "x", status: 403 },
  writes: [],
  traffic: { landed: false, markerRead: [], outbound: [] },
  victim,
  actorId: "bob",
  ...over,
});
const write = (tbl: string) => ({
  tbl,
  op: "INSERT",
  owner: "bob",
  old_owner: null,
  points_at: null,
});

describe("what the access proof would miss", () => {
  it("a refused caller's write to a table the exception doesn't name", () => {
    const problems = judge(
      observed({
        writes: [write("audit_log"), write("transactions")],
        allowedWrites: ["audit_log"],
      }),
    );
    expect(problems).toEqual(["wrote without access: transactions"]);
  });

  it("a call that never answered", () => {
    const problems = judge(
      observed({ access: "public", answer: { name: "x", threw: "timed out: GET /x" } }),
    );
    expect(problems.join()).toContain("never answered");
  });

  it("what a page hands a component that draws nothing", async () => {
    const Silent = () => null;
    const tree = await resolveTree(createElement(Silent, null, "zqmarkzq"));
    expect(JSON.stringify(tree)).toContain("zqmarkzq");
  });

  it("a socket opened to a port and a host given one after the other", async () => {
    installProbes();
    const socket = new net.Socket();
    const failed = new Promise<string>((resolve) =>
      socket.on("error", (error) => resolve(error.message)),
    );
    // A documentation address (RFC 5737): nothing answers there.
    socket.connect(443, "192.0.2.1");
    await expect(failed).resolves.toContain("Blocked by the access proof");
    expect(seen().outbound).toContain("192.0.2.1");
  });
});

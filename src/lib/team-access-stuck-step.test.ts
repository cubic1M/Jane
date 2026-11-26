import { describe, expect, it } from "vitest";
import { CONNECTOR_WHY, TEAM, teamAccessEntries, type AuditRow } from "./team-access";

// "Who saw my data": the team settling a step with a company that stopped part way is a team action
// on the person's data. Its audit row names a connector action, not a request (src/lib/connectors/
// stuck.ts), and the history dropped every one.
const ME = "user_me";
const row = (userId: string, targetType = "connector_action"): AuditRow => ({
  id: "row_1",
  event: "connector_action_marked",
  actorType: "admin",
  actorId: "admin_secret_id",
  targetType,
  targetId: "conn_act_1",
  metadata: { outcome: "succeeded", user_id: userId },
  createdAt: new Date("2026-10-01T12:00:00Z"),
});
const mine = (rows: AuditRow[]) => teamAccessEntries(rows, { userId: ME, actions: new Map() });

describe("a stuck step the team settled", () => {
  it("is on the person's history, without the admin's id or the step's", () => {
    const entries = mine([row(ME)]);
    expect(entries).toEqual([
      {
        key: "row_1",
        at: new Date("2026-10-01T12:00:00Z"),
        who: TEAM,
        what: "Marked a stuck step done, after checking with the company",
        why: CONNECTOR_WHY,
        actionId: null,
      },
    ]);
    expect(JSON.stringify(entries)).not.toContain("admin_secret_id");
  });

  it("is nobody else's, and nothing that names another kind of record", () => {
    expect(mine([row("user_other")])).toEqual([]);
    expect(mine([row(ME, "action")].map((r) => ({ ...r, metadata: {} })))).toEqual([]);
    expect(mine([row(ME, "user")])).toEqual([]);
  });
});

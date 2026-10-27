import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./audit";
import {
  AGENT,
  SHOWN_EVENTS,
  TEAM,
  TEAM_ACCESS_RULES,
  PERSON_WHY,
  UNDONE_WHY,
  teamAccessEntries,
  type ActionInfo,
  type AuditRow,
} from "./team-access";

// Who saw my data (spec step 74).

const ME = "user_me";
const OTHER = "user_other";
const ADMIN_ID = "admin_secret_id";

const actions = new Map<string, ActionInfo>([
  ["act_1", { title: "Cancel Netflix", company: "Netflix" }],
  ["act_2", { title: "Get your bank fees back", company: null }],
]);

let n = 0;
function row(event: string, overrides: Partial<AuditRow> = {}): AuditRow {
  n += 1;
  return {
    id: `row_${String(n).padStart(3, "0")}`,
    event,
    actorType: "admin",
    actorId: ADMIN_ID,
    targetType: "action",
    targetId: "act_1",
    metadata: { user_id: ME },
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, n)),
    ...overrides,
  };
}

const entriesFor = (rows: AuditRow[]) => teamAccessEntries(rows, { userId: ME, actions });
const one = (r: AuditRow) => {
  const entries = entriesFor([r]);
  expect(entries).toHaveLength(1);
  return entries[0];
};

// Every event name declared in src/lib/audit.ts, read from the source so this test fails
// the moment one is added there without a decision here (the Record type fails tsc too).
function declaredEvents(): string[] {
  const source = readFileSync(join(process.cwd(), "src/lib/audit.ts"), "utf8");
  const union = source.slice(
    source.indexOf("export type AuditEvent"),
    source.indexOf("export type AuditActor"),
  );
  return [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("the mapping covers every audit event", () => {
  it("has a decision for every event declared in audit.ts, and no stale ones", () => {
    const declared = declaredEvents();
    expect(declared.length).toBeGreaterThan(50);
    expect(Object.keys(TEAM_ACCESS_RULES).sort()).toEqual([...declared].sort());
  });

  it("shows exactly the team's and the agent's events about one person", () => {
    expect([...SHOWN_EVENTS].sort()).toEqual(
      [
        "admin_viewed_queue",
        "admin_viewed_action",
        "admin_viewed_activity",
        "action_status_changed",
        "action_assigned",
        "admin_drafted_message",
        "referral_conversion_recorded",
        "agent_message_sent",
        "agent_reply_received",
        "agent_handed_off",
        "agent_call_started",
        "refund_seen",
      ].sort(),
    );
  });

  it.each([
    ["user_signed_up", "own"],
    ["user_signed_in", "own"],
    ["import_completed", "own"],
    ["explanations_generated", "automatic"],
    ["decision_made", "own"],
    ["decision_undone", "own"],
    ["item_linked", "own"],
    ["admin_viewed_metrics", "not_one_person"],
    ["membership_paid", "automatic"],
    ["item_removed", "own"],
    ["user_data_deleted", "own"],
    ["admin_mfa_enrolled", "own"],
    ["admin_mfa_verified", "own"],
    ["admin_mfa_failed", "own"],
    ["user_made_admin", "own"],
    ["invite_code_created", "not_one_person"],
    ["terms_accepted", "own"],
    ["data_exported", "own"],
    ["merchant_saved", "not_one_person"],
    ["switch_option_saved", "not_one_person"],
    ["switch_option_reviewed", "not_one_person"],
    ["switch_option_removed", "not_one_person"],
    ["diy_done", "own"],
    ["household_invite_sent", "own"],
    ["household_joined", "own"],
    ["household_left", "own"],
    ["account_sharing_changed", "own"],
    ["referral_partner_saved", "not_one_person"],
    ["job_retried", "not_one_person"],
    ["saved_reply_saved", "not_one_person"],
    ["saved_reply_deleted", "not_one_person"],
    ["admin_viewed_health", "not_one_person"],
    ["charge_split", "own"],
    ["household_settled", "own"],
    ["mfa_enabled", "own"],
    ["mfa_verified", "own"],
    ["mfa_failed", "own"],
    ["mfa_disabled", "own"],
    ["mfa_backup_code_used", "own"],
    ["mfa_backup_codes_created", "own"],
    ["standing_rules_saved", "own"],
    ["autopilot_set", "own"],
    ["plan_link_used", "own"],
    ["support_contact_suggested", "not_one_person"],
    ["support_contact_confirmed", "not_one_person"],
    ["proposal_answered", "own"],
    ["document_uploaded", "own"],
    ["document_read", "own"],
    ["document_viewed", "own"],
    ["document_facts_saved", "own"],
    ["document_deleted", "own"],
    ["tax_pack_downloaded", "own"],
    ["session_signed_out", "own"],
    ["other_sessions_signed_out", "own"],
  ] as [AuditEvent, string][])("hides %s (%s)", (event, because) => {
    expect(TEAM_ACCESS_RULES[event]).toEqual({ shown: false, because });
    // Even an admin or system row about the person's action stays off the page.
    expect(entriesFor([row(event), row(event, { actorType: "system", actorId: null })])).toEqual(
      [],
    );
  });
});

describe("what each shown event says", () => {
  it.each([
    ["admin_viewed_action", {}, "Viewed your request"],
    ["action_status_changed", { from: "queued", to: "in_progress" }, "Started working on it"],
    ["action_status_changed", { from: "in_progress", to: "done" }, "Marked it done"],
    ["action_status_changed", { from: "in_progress", to: "failed" }, "Marked it as not possible"],
    [
      "action_status_changed",
      { from: "in_progress", to: "waiting_on_user" },
      "Asked you for something",
    ],
    ["action_status_changed", { from: "in_progress", to: "queued" }, "Put it back in the queue"],
    ["action_status_changed", { from: "in_progress", to: "in_progress" }, "Updated its notes"],
    ["action_status_changed", { from: "queued", to: "mystery" }, "Updated its status"],
    ["action_assigned", { from: null, to: "sam@example.com" }, "Gave it to a team member"],
    ["action_assigned", { from: "sam@example.com", to: null }, "Took it off a team member's list"],
    ["admin_drafted_message", {}, "Drafted a message for it"],
    ["referral_conversion_recorded", {}, "Noted the partner's payment for it"],
  ])("%s %j: %s, by the team", (event, metadata, what) => {
    const entry = one(row(event, { metadata: { ...metadata, user_id: ME } }));
    expect(entry).toMatchObject({ who: TEAM, what, why: "Cancel Netflix", actionId: "act_1" });
  });

  it.each([
    ["agent_message_sent", { follow_up: false }, "act_1", "Wrote to Netflix"],
    ["agent_message_sent", { follow_up: true }, "act_1", "Wrote to Netflix again"],
    ["agent_message_sent", { follow_up: false }, "act_2", "Wrote to the company"],
    ["agent_reply_received", {}, "act_1", "Read Netflix's reply"],
    ["agent_reply_received", {}, "act_2", "Read the company's reply"],
    ["agent_handed_off", { reason: "No support email" }, "act_1", "Passed it to the team"],
    ["agent_call_started", {}, "act_1", "Called Netflix"],
    ["agent_call_started", {}, "act_2", "Called the company"],
    ["refund_seen", { refund_cents: 3_500 }, "act_2", "Saw your refund come in"],
  ])("%s %j on %s: %s, by the agent", (event, metadata, actionId, what) => {
    const entry = one(
      row(event, {
        actorType: "system",
        actorId: null,
        targetId: actionId,
        metadata: { ...metadata, user_id: ME },
      }),
    );
    expect(entry).toMatchObject({ who: AGENT, what, actionId });
  });

  it("turns one queue view into an entry per action of theirs it listed", () => {
    const entries = entriesFor([
      row("admin_viewed_queue", {
        targetType: "user",
        targetId: ME,
        metadata: { action_ids: "act_1,act_2", count: 7 },
      }),
    ]);
    expect(entries.map((e) => [e.what, e.why, e.actionId])).toEqual([
      ["Saw your request in the team's list", "Get your bank fees back", "act_2"],
      ["Saw your request in the team's list", "Cancel Netflix", "act_1"],
    ]);
  });
});

describe("a look at how the person used Jane (the beta's activity log)", () => {
  it("shows a view of their own timeline, about no one request", () => {
    const entry = one(
      row("admin_viewed_activity", {
        targetType: "user",
        targetId: ME,
        metadata: { view: "timeline" },
      }),
    );
    expect(entry).toMatchObject({
      who: TEAM,
      what: "Looked at how you used Jane (pages and buttons, not what you typed)",
      why: PERSON_WHY,
      actionId: null,
    });
  });

  it("leaves out the list of everyone and someone else's timeline", () => {
    expect(
      entriesFor([
        row("admin_viewed_activity", {
          targetType: null,
          targetId: null,
          metadata: { view: "list" },
        }),
        row("admin_viewed_activity", { targetType: "user", targetId: OTHER }),
      ]),
    ).toEqual([]);
  });
});

describe("only the person's own entries, by role", () => {
  it("drops rows about someone else's action or someone else's queue view", () => {
    expect(
      entriesFor([
        row("admin_viewed_action", { targetId: "act_theirs", metadata: { user_id: OTHER } }),
        row("admin_viewed_queue", {
          targetType: "user",
          targetId: OTHER,
          metadata: { action_ids: "act_1" },
        }),
        row("admin_viewed_queue", { targetType: null, targetId: null, metadata: { count: 3 } }),
        row("agent_message_sent", { targetType: "merchant", targetId: "act_1" }),
      ]),
    ).toEqual([]);
  });

  it("keeps an undone action's entries through its user_id, without a link", () => {
    const entry = one(row("admin_viewed_action", { targetId: "act_gone" }));
    expect(entry).toMatchObject({ why: UNDONE_WHY, actionId: null });
  });

  it("excludes the person's own events, even as an admin", () => {
    expect(
      entriesFor([
        row("admin_viewed_action", { actorType: "user", actorId: ME }),
        row("admin_viewed_action", { actorType: "admin", actorId: ME }),
      ]),
    ).toEqual([]);
  });

  it("never carries the admin's id, and ignores events it doesn't know", () => {
    const entries = entriesFor([row("admin_viewed_action"), row("some_old_event")]);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(ADMIN_ID);
  });

  it("lists newest first", () => {
    const older = row("admin_viewed_action");
    const newer = row("action_status_changed", { metadata: { from: "queued", to: "done" } });
    expect(entriesFor([older, newer]).map((e) => e.what)).toEqual([
      "Marked it done",
      "Viewed your request",
    ]);
  });
});

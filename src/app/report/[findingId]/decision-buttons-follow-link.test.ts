import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Review of #2236: the card's "Follow it" link waits for the saved answer and opens the
// connector's own page when a connector planned the yes, not /actions, so a click while the yes is
// still on its way doesn't override the move to Connections.
describe("the follow-up link after a yes", () => {
  const source = readFileSync(join(__dirname, "decision-buttons.tsx"), "utf8");

  it("goes to Connections for a connector's plan and /actions for a queued action", () => {
    const click = source.slice(
      source.indexOf("const sent = sending.current;", source.indexOf("<Link")),
    );
    const follow = click.slice(0, click.indexOf("className="));
    expect(follow).toContain("connectorActionId");
    expect(follow).toContain("/settings/connections#actions");
    expect(follow).toContain('shownHref("/actions")');
  });
});

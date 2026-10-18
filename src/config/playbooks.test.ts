import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "./playbooks";

describe("playbooks", () => {
  it("has a complete playbook for refund requests", () => {
    const playbook = PLAYBOOKS.request_refund;
    expect(playbook?.steps.length).toBeGreaterThan(0);
    expect(playbook?.askFor.length).toBeGreaterThan(0);
    expect(playbook?.close).toMatch(/Done when/);
  });

  it("never tells the team to collect card numbers or logins", () => {
    for (const playbook of Object.values(PLAYBOOKS)) {
      const text = [...playbook.steps, ...playbook.askFor].join(" ").toLowerCase();
      expect(text).not.toMatch(
        /(ask|get|collect) (for )?(their|the person's) (card number|password|login)/,
      );
    }
  });
});

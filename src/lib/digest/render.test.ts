import { describe, expect, it } from "vitest";
import { renderDigest } from "./render";

const LINKS = {
  report: "https://app.example.com/api/digest/click?d=d1&to=%2Freport",
  actions: "https://app.example.com/api/digest/click?d=d1&to=%2Factions",
  alerts: "https://app.example.com/api/digest/click?d=d1&to=%2Falerts",
  settings: "https://app.example.com/api/digest/click?d=d1&to=%2Fsettings",
  unsubscribe: "https://app.example.com/unsubscribe?token=t",
};

const payload = {
  savedThisWeekCents: 14_388,
  savedToDateCents: 35_976,
  moneyFoundCents: 50_000,
  finishedThisWeek: [{ title: "Cancel <Hulu>", annualSavingsCents: 14_388 }],
  pending: [
    { title: "Refund fees", status: "waiting_on_user" as const, userTodo: "Call your bank" },
  ],
  newFindings: [],
  alerts: [],
  membershipOffer: false,
};

describe("renderDigest", () => {
  it("leads with this week's savings and puts what the person must do first", () => {
    const email = renderDigest(payload, LINKS);

    expect(email.subject).toBe("You saved about $143.88 a year this week");
    expect(email.text.indexOf("We need something from you")).toBeLessThan(
      email.text.indexOf("Finished this week"),
    );
    expect(email.text).toContain("- Refund fees: Call your bank");
    expect(email.text).toContain(`Unsubscribe: ${LINKS.unsubscribe}`);
  });

  it("escapes HTML and links through click tracking", () => {
    const { html } = renderDigest(payload, LINKS);

    expect(html).toContain("Cancel &lt;Hulu&gt;");
    expect(html).not.toContain("<Hulu>");
    expect(html).toContain(
      'href="https://app.example.com/api/digest/click?d=d1&amp;to=%2Factions"',
    );
    expect(html).not.toMatch(/<img/);
  });

  it("uses a plain headline in a week with nothing finished", () => {
    expect(renderDigest({ ...payload, savedThisWeekCents: 0 }, LINKS).subject).toBe(
      "Your week in money",
    );
  });

  it("lists alerts with a link to the alerts page", () => {
    const { text } = renderDigest(
      { ...payload, alerts: [{ title: "$35.00 fee on Checking" }] },
      LINKS,
    );

    expect(text).toContain("Alerts\n- $35.00 fee on Checking");
    expect(text).toContain(`See your alerts: ${LINKS.alerts}`);
    // A payload stored before alerts existed still renders.
    const old = { ...payload, alerts: undefined } as unknown as typeof payload;
    expect(renderDigest(old, LINKS).text).not.toContain("See your alerts");
  });

  it("includes the membership offer when it's due", () => {
    const { text } = renderDigest({ ...payload, membershipOffer: true }, LINKS);

    expect(text).toContain("We'll keep doing this for you, ongoing");
    expect(text).toContain(`See membership: ${LINKS.actions}`);
  });
});

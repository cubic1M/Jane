import { describe, expect, it } from "vitest";
import { renderDigest } from "./render";

const LINKS = {
  report: "https://app.example.com/api/digest/click?d=d1&to=%2Freport",
  actions: "https://app.example.com/api/digest/click?d=d1&to=%2Factions",
  alerts: "https://app.example.com/api/digest/click?d=d1&to=%2Falerts",
  budgets: "https://app.example.com/api/digest/click?d=d1&to=%2Fbudgets",
  goals: "https://app.example.com/api/digest/click?d=d1&to=%2Fgoals",
  netWorth: "https://app.example.com/api/digest/click?d=d1&to=%2Fnet-worth",
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

  it("shows budgets, goals and net worth only when there's something to show", () => {
    const { text } = renderDigest(
      {
        ...payload,
        budgets: [
          { category: "Food and drink", spentCents: 23_000, budgetCents: 20_000, over: true },
        ],
        goals: [
          { name: "Trip", percent: 40, savedChangeCents: 10_000 },
          { name: "Car", percent: 10, savedChangeCents: null },
        ],
        netWorth: { nowCents: 1_234_500, changeCents: -20_000 },
      },
      LINKS,
    );
    expect(text).toContain("Budgets this month\n- Food and drink: $230.00 of $200.00 (over)");
    expect(text).toContain("- Trip: 40% (+$100.00 this week)\n- Car: 10%");
    expect(text).toContain("Net worth\n- $12,345.00, down $200.00 this week");
    expect(text).toContain(`See your net worth: ${LINKS.netWorth}`);

    const plain = renderDigest(payload, LINKS).text;
    for (const heading of ["Budgets this month", "Your goals", "Net worth"]) {
      expect(plain).not.toContain(heading);
    }
  });

  it("includes the membership offer when it's due", () => {
    const { text } = renderDigest({ ...payload, membershipOffer: true }, LINKS);

    expect(text).toContain("We'll keep doing this for you, ongoing");
    expect(text).toContain(`See membership: ${LINKS.actions}`);
  });
});

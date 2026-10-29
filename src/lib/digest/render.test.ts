import { describe, expect, it } from "vitest";
import { FACTS_NOT_ADVICE, checkupLine, renderDigest } from "./render";

const LINKS = {
  plan: "https://app.example.com/api/digest/click?d=d1&to=%2Fplan",
  report: "https://app.example.com/api/digest/click?d=d1&to=%2Freport",
  actions: "https://app.example.com/api/digest/click?d=d1&to=%2Factions",
  alerts: "https://app.example.com/api/digest/click?d=d1&to=%2Falerts",
  budgets: "https://app.example.com/api/digest/click?d=d1&to=%2Fbudgets",
  goals: "https://app.example.com/api/digest/click?d=d1&to=%2Fgoals",
  netWorth: "https://app.example.com/api/digest/click?d=d1&to=%2Fnet-worth",
  close: "https://app.example.com/api/digest/click?d=d1&to=%2Fclose",
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
  it("links the monthly close in every email, near the top", () => {
    const email = renderDigest(payload, LINKS);
    expect(email.text).toContain(`See your monthly close: ${LINKS.close}`);
    expect(email.text.indexOf("See your monthly close")).toBeLessThan(
      email.text.indexOf("We need something from you"),
    );
    expect(email.html).toContain(`href="${LINKS.close.replaceAll("&", "&amp;")}"`);
  });

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

  it("leads with what changed: alerts, then changes, each with how sure Jane is", () => {
    const email = renderDigest(
      {
        ...payload,
        alerts: [{ title: "$35.00 fee on Checking", percent: 92 }, { title: "Old alert" }],
        changes: [{ title: "Comcast went up from $80.00 to $95.00.", percent: 84 }],
      },
      LINKS,
    );

    expect(email.subject).toBe("3 things changed in your money this week");
    expect(email.text).toContain(
      "What changed\n- $35.00 fee on Checking (92% sure)\n- Old alert\n- Comcast went up from $80.00 to $95.00 (84% sure)",
    );
    // One link back to Jane for all of it.
    expect(email.text).toContain(`See it in Jane: ${LINKS.alerts}`);
    expect(email.text.indexOf("What changed")).toBeLessThan(
      email.text.indexOf("We need something from you"),
    );
    // A payload stored before alerts existed still renders.
    const old = { ...payload, alerts: undefined } as unknown as typeof payload;
    expect(renderDigest(old, LINKS).text).not.toContain("What changed");
  });

  it("says one thing changed in the singular", () => {
    const email = renderDigest({ ...payload, changes: [{ title: "x", percent: 70 }] }, LINKS);
    expect(email.subject).toBe("1 thing changed in your money this week");
  });

  it("gives new findings their confidence band", () => {
    const { text } = renderDigest(
      {
        ...payload,
        newFindings: [
          { title: "Bank fees", annualSavingsCents: 4_200, confidence: "high" },
          { title: "Idle cash", annualSavingsCents: null, confidence: "medium" },
          { title: "Maybe a trial", annualSavingsCents: null, confidence: "low" },
        ],
      },
      LINKS,
    );
    expect(text).toContain("- Bank fees (about $42.00 a year) (80%+ sure)");
    expect(text).toContain("- Idle cash (50–79% sure)");
    expect(text).toContain("- Maybe a trial (under 50% sure)");
  });

  it("sums the checkup in one line, linked to the report", () => {
    const { text } = renderDigest(
      { ...payload, checkup: { checks: 12, found: 2, passed: 9, notEnoughData: 1 } },
      LINKS,
    );
    expect(text).toContain(
      "Jane's checkup\n- Jane ran 12 checks: 2 found something, 9 found nothing wrong, 1 needs more data.",
    );
    expect(text).toContain(`See every check: ${LINKS.report}`);
    expect(checkupLine({ checks: 1, found: 0, passed: 1, notEnoughData: 0 })).toBe(
      "Jane ran 1 check: 1 found nothing wrong.",
    );
  });

  it("says saved so far only once something was saved", () => {
    expect(renderDigest(payload, LINKS).text).toContain("about $359.76 a year");
    expect(renderDigest({ ...payload, savedToDateCents: 0 }, LINKS).text).not.toContain(
      "Saved so far",
    );
  });

  it("says these are facts, not advice, and always has an unsubscribe link", () => {
    const email = renderDigest(payload, LINKS);
    expect(email.text).toContain(FACTS_NOT_ADVICE);
    expect(email.html).toContain(FACTS_NOT_ADVICE);
    expect(email.html).toContain(`href="${LINKS.unsubscribe}"`);
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
    // What the figure leaves out for want of a balance is said beside it.
    const partial = renderDigest(
      {
        ...payload,
        netWorth: {
          nowCents: 1_234_500,
          changeCents: 0,
          notCounting: "not counting card balance",
        },
      },
      LINKS,
    ).text;
    expect(partial).toContain("- $12,345.00, no change this week (not counting card balance)");

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

  it("links Jane's plan when items wait for an answer", () => {
    const email = renderDigest({ ...payload, plan: { items: 3 } }, LINKS);
    expect(email.text).toContain("Jane's plan this week");
    expect(email.text).toContain("3 things Jane can do for you");
    expect(email.text).toContain(`Review your plan: ${LINKS.plan}`);
    expect(renderDigest({ ...payload, plan: { items: 0 } }, LINKS).text).not.toContain(
      "Jane's plan",
    );
  });

  it("says what Jane did this week, with only confirmed money", () => {
    const email = renderDigest(
      {
        ...payload,
        janeDid: { finished: 2, confirmedCents: 6_420, contacts: 3, working: 1, waiting: 1 },
      },
      LINKS,
    );
    expect(email.text).toContain("What Jane did for you this week");
    expect(email.text).toContain("Finished 2 things, with $64.20 back or agreed.");
    expect(email.text).toContain("Wrote or called 3 times on your behalf.");
    expect(email.text).toContain("1 thing needs something from you.");
    const quiet = renderDigest(
      {
        ...payload,
        janeDid: { finished: 0, confirmedCents: 0, contacts: 0, working: 0, waiting: 0 },
      },
      LINKS,
    );
    expect(quiet.text).not.toContain("What Jane did");
  });

  it("offers a one-tap link when there is one", () => {
    const email = renderDigest(
      { ...payload, plan: { items: 4 } },
      { ...LINKS, goAhead: { url: "https://app.example.com/plan/go?token=t", count: 2 } },
    );
    expect(email.text).toContain("Go ahead in one tap");
    expect(email.text).toContain("Go ahead with 2: https://app.example.com/plan/go?token=t");
    expect(renderDigest(payload, LINKS).text).not.toContain("one tap");
  });
});

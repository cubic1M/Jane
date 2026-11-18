import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { stateMove } from "@/profile/home-state";
import { STUDENT_SHAPES, STUDENT_TODAY, inputFromStatements } from "./__fixtures__/student-walk";
import { STATE_MOVE_DETECTORS } from "./state-move";
import { STUDENT_CREDIT_DETECTORS } from "./student-credits";
import { runDetectors } from "./index";

// A move into or out of California during the year (suggest-taxes gap pass).

const buy = (date: string, where: string) => ({
  date,
  amountCents: 2_000,
  description: `SHOP ${where}`,
});
const months = (from: number, to: number, where: string) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((m) =>
    ["05", "15", "25"].map((d) => buy(`2026-${String(m).padStart(2, "0")}-${d}`, where)),
  );

describe("a move between states, from where someone pays", () => {
  it("finds the month purchases settle in another state", () => {
    expect(stateMove([...months(6, 8, "AUSTIN TX"), ...months(9, 11, "PALO ALTO CA")])).toEqual({
      from: "TX",
      to: "CA",
      month: "2026-09",
    });
  });

  it("doesn't read a trip, a single month, or a thin month as a move", () => {
    expect(
      stateMove([
        ...months(6, 8, "PALO ALTO CA"),
        ...months(9, 9, "SEATTLE WA"),
        ...months(10, 11, "PALO ALTO CA"),
      ]),
    ).toBeNull();
    expect(stateMove(months(9, 9, "PALO ALTO CA"))).toBeNull();
    // One located purchase a month isn't enough to say where someone lives.
    expect(
      stateMove([buy("2026-08-05", "AUSTIN TX"), ...months(9, 11, "PALO ALTO CA")]),
    ).toBeNull();
  });
});

describe("California's part-year return", () => {
  const run = (data: ProfileInput) =>
    runDetectors({ profile: buildProfile(data), data }, STATE_MOVE_DETECTORS)[0] ?? null;

  it("tells a student who moved from Texas in September about Form 540NR", async () => {
    const data = await inputFromStatements(STUDENT_SHAPES["moved-to-stanford"](), STUDENT_TODAY);
    const s = run(data)!;
    // Late September's purchases are still mostly in Austin: October is the first month in California.
    expect(s.title).toContain("moved to California by October 2026");
    expect(s.why).toContain("Form 540NR");
    expect(s.why).toContain("Texas has no income tax on wages");
    for (const t of [s.title, s.headline, s.short, s.why]) {
      expect(
        checkGuardrails(
          t,
          dollarFigures(t).map((f) => f.cents),
        ),
        t,
      ).toEqual({ ok: true });
      expect(tellsThemToAct(t), t).toBe(false);
      expect(recommendsAChoice(t), t).toBe(false);
    }
  });

  it("is only for a move into or out of California", () => {
    const rows = [...months(6, 8, "AUSTIN TX"), ...months(9, 11, "SEATTLE WA")].map((t) => ({
      ...t,
      pfc: null,
      accountId: "a",
    }));
    const data: ProfileInput = {
      today: STUDENT_TODAY,
      transactions: rows,
      accounts: [],
      liabilities: [],
      told: {},
    };
    expect(run(data)).toBeNull();
  });
});

describe("tuition paid in December", () => {
  it("is said on the education credit card from November", () => {
    const data = (today: string): ProfileInput => ({
      today,
      transactions: [
        {
          date: "2026-09-20",
          amountCents: 320_000,
          description: "STANFORD UNIVERSITY TUITION PAYMENT",
          pfc: "GENERAL_SERVICES_EDUCATION",
          accountId: "a",
        },
        {
          date: "2026-09-18",
          amountCents: 1_000,
          description: "SAFEWAY MOUNTAIN VIEW CA",
          pfc: null,
          accountId: "a",
        },
      ],
      accounts: [],
      liabilities: [],
      told: { claimed_as_dependent: "yes", enrollment: "undergrad" },
    });
    const card = (today: string) =>
      runDetectors(
        { profile: buildProfile(data(today)), data: data(today) },
        STUDENT_CREDIT_DETECTORS,
      ).find((s) => s.topic === "education_credit")!;
    expect(card("2026-11-01").why).toContain(
      "Tuition paid by December 31 for a term that starts by the end of March",
    );
    expect(card("2026-10-31").why).not.toContain("Tuition paid by December 31");
  });
});

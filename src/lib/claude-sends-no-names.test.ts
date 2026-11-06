import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyMerchants } from "@/categorize/llm";
import { claudeFetch } from "@/lib/anthropic";
import { familyLoansToolOutput } from "@/lib/jane-agent/debt-tools";
import { checkSubscriptions } from "@/lib/subscription-check";

// What Claude is sent, through the paths that exist with or without src/lib/person-payees.ts: no
// person's name from a payment app's merchant text (roadmap research round 11).

const PERSON = "[a person]";

describe("what reaches Claude", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("claudeFetch sends the request with names taken out", async () => {
    const sent: { body: string; headers: Headers }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        sent.push({ body: String(init?.body), headers: new Headers(init?.headers) });
        return new Response("{}");
      }),
    );
    const body = JSON.stringify({ messages: [{ role: "user", content: "ZELLE TO DANIEL SMITH" }] });
    await claudeFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(body.length) },
    });
    expect(sent[0]!.body).not.toContain("DANIEL");
    expect(sent[0]!.body).toContain(PERSON);
    expect(sent[0]!.headers.get("content-length")).toBeNull();
  });

  const recorder = (reply: (merchants: string[]) => unknown) => {
    const asked: string[][] = [];
    const create = vi.fn(async (params: { messages: { content: string }[] }) => {
      const { merchants } = JSON.parse(params.messages[0]!.content) as { merchants: string[] };
      asked.push(merchants);
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ results: reply(merchants) }) }],
      };
    });
    return { asked, client: () => ({ messages: { create } }) as never };
  };

  it("the categorizer never asks about a person", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-local-not-a-key");
    const { asked, client } = recorder(() => []);
    await classifyMerchants(["COSTCO WHSE", "DANIEL SMITH", "ZELLE TO EMILY ROSE"], {
      claude: client,
    });
    expect(asked.flat()).toEqual(["COSTCO WHSE"]);
    const none = recorder(() => []);
    await classifyMerchants(["JENNIFER LOPEZ"], { claude: none.client });
    expect(none.asked).toEqual([]);
  });

  it("the subscription check never asks about a person", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fake-local-not-a-key");
    const { asked, client } = recorder(() => []);
    await checkSubscriptions(["SPOTIFY", "Emily R Rose", "VENMO *JOHN DOE"], { claude: client });
    expect(asked.flat()).toEqual(["SPOTIFY"]);
  });

  it("the family-loans tool gives the chat initials, not names or the drafted notes", () => {
    const transfer = { amountCents: -25_000, date: "2026-10-02" };
    const output = familyLoansToolOutput(
      {
        candidates: [
          {
            id: "c1",
            kind: "lent",
            transfer,
            parsed: { app: "Venmo", counterparty: "Daniel Smith", note: "for Maria's rent" },
          },
        ],
        loans: [
          {
            kind: "lent",
            counterparty: "Emily Rose",
            principalCents: 50_000,
            balanceCents: 20_000,
            openedOn: "2026-09-01",
            repaid: [],
            reminder: { text: "Hi Emily, just a nudge on the $300." },
          },
        ],
        cosigned: [
          {
            debtName: "Car loan",
            counterparty: "Jordan Lee",
            missed: true,
            pastDueCents: 31_000,
            text: "Hi Jordan, a payment looks late.",
          },
        ],
        shared: [],
      } as never,
      (cents) => `$${(cents / 100).toFixed(2)}`,
    );
    const text = JSON.stringify(output);
    for (const name of ["Daniel", "Smith", "Emily", "Rose", "Jordan", "Lee", "Maria"]) {
      expect(text).not.toContain(name);
    }
    expect(text).toContain("D. S.");
  });
});

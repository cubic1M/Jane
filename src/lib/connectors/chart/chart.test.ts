import { describe, expect, it, vi } from "vitest";
import { CHART, REAL_CONNECTORS } from "@/config/connectors";
import { parseTranscript } from "@/lib/connectors/irs-transcript/parse";
import { demoTranscriptText } from "@/lib/tax-transcripts/demo";
import { allConnectors, whyUnavailable } from "../registry";
import { ChartError, chartHttp, type ChartRecord } from "./api";
import { sandboxChartTranscripts } from "./connector";
import { transcriptText } from "./normalize";
import { chartTranscriptPartner, sandboxChartPartner } from "./partner";

// Chart (read connectors, 11-18), with records shaped by Chart's OpenAPI definition (Record and
// ACTR_Individual, developer.trychart.com/api-reference/openapi.json, read 2026-11-17). No network:
// a fake fetch.

const ENV = { [CHART.clientIdEnv]: "test-client", [CHART.clientSecretEnv]: "test-secret-value" };

// A 2025 account transcript as Chart's Record carries it, with a code Jane doesn't read and a line
// whose date isn't one it can read.
const RECORD: ChartRecord = {
  id: "clt0szoxp0001p82z45ufj6t4",
  tax_year: "2025",
  provider_id: "chart-sandbox",
  forms: [
    {
      type: "ACTR",
      year: "2025",
      name: "John Doe",
      tin: "XXX-XX-1234",
      account_summary: { account_balance: 0 },
      transactions: [
        {
          code: "150",
          explanation_of_transaction: "Tax return filed",
          date: "2026-04-15",
          amount: 4210.5,
        },
        {
          code: "806",
          explanation_of_transaction: "W-2 or 1099 withholding",
          date: "04/15/2026",
          amount: -5100,
        },
        {
          code: "846",
          explanation_of_transaction: "Refund issued",
          date: "05-04-2026",
          amount: 889.5,
        },
        {
          code: "290",
          explanation_of_transaction: "Additional tax assessed",
          date: "2026-06-01",
          amount: 0,
        },
        { code: "766", explanation_of_transaction: "Credit", date: "June 2026", amount: -100 },
      ],
    },
    { type: "W2", year: "2025" },
  ],
};

describe("Chart's account transcripts, read by Jane's own transcript reader", () => {
  const transcript = parseTranscript(transcriptText(RECORD.forms![0] as never));

  it("keeps the year, the balance and the codes Jane reads, in Jane's words", () => {
    expect(transcript).toEqual({
      taxYear: 2025,
      balanceCents: 0,
      lines: [
        { code: "150", what: "Return filed", on: "2026-04-15", cents: 421_050 },
        { code: "806", what: "Withholding", on: "2026-04-15", cents: -510_000 },
        { code: "846", what: "Refund issued", on: "2026-05-04", cents: 88_950 },
      ],
    });
  });

  it("carries over no name, TIN or Chart's own words", () => {
    const text = transcriptText(RECORD.forms![0] as never);
    expect(text).not.toMatch(/John Doe|1234|Tax return filed|Refund issued/);
  });

  it("lists each account transcript, and hands one over by id", async () => {
    const partner = chartTranscriptPartner({
      name: "chart",
      connectUrl: "https://connect.trychart.com",
      records: async () => [RECORD],
    });
    const { consentId } = await partner.startConsent("user_1");
    const listed = await partner.listTranscripts(consentId);
    expect(listed).toEqual([{ id: `${RECORD.id}:2025`, kind: "account", taxYear: 2025 }]);
    expect(
      parseTranscript(await partner.fetchTranscript(consentId, listed[0]!.id)).lines,
    ).toHaveLength(3);
    await expect(partner.fetchTranscript(consentId, "other:2025")).rejects.toThrow();
  });

  it("gives the sandbox twin the demo stand-in's transcripts, read through Chart's shape", async () => {
    const partner = sandboxChartPartner(2026, "user_sample");
    const { consentId } = await partner.startConsent("user_sample");
    const listed = await partner.listTranscripts(consentId);
    expect(listed.map((l) => l.taxYear)).toEqual([2025, 2024]);
    for (const l of listed) {
      expect(parseTranscript(await partner.fetchTranscript(consentId, l.id))).toEqual(
        parseTranscript(demoTranscriptText(l.taxYear, "user_sample")),
      );
    }
  });
});

describe("Chart's API, as its reference describes it", () => {
  it("swaps Chart Connect's code for the taxpayer's access token", async () => {
    const send = vi.fn(async () =>
      Response.json({ taxpayer_id: "tp_1", provider_id: "chart-sandbox", access_token: "at-abc" }),
    );
    const link = await chartHttp({ env: ENV, fetch: send as never }).exchangeCode("code-1", null);
    expect(link).toEqual({
      taxpayerId: "tp_1",
      providerId: "chart-sandbox",
      accessToken: "at-abc",
    });
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychart.com/auth/token");
    expect(JSON.parse(String(init.body))).toEqual({
      client_id: "test-client",
      client_secret: "test-secret-value",
      code: "code-1",
    });
  });

  it("lists records with the token as the bearer and the API version", async () => {
    const send = vi.fn(async () => Response.json([RECORD, { not: "a record" }]));
    const records = await chartHttp({ env: ENV, fetch: send as never }).records("at-abc");
    expect(records.map((r) => r.id)).toEqual([RECORD.id]);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychart.com/records");
    expect(init.headers).toMatchObject({
      authorization: "Bearer at-abc",
      "chart-api-version": "2024-01-01",
    });
  });

  it("says a refusal without the token or the keys, and calls nobody without keys", async () => {
    const refused = vi.fn(async () => new Response("no", { status: 401 }));
    const error = await chartHttp({ env: ENV, fetch: refused as never })
      .records("at-secret-token")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChartError);
    expect(String((error as Error).message)).not.toMatch(/at-secret-token|test-secret-value/);
    const send = vi.fn();
    await expect(
      chartHttp({ env: {}, fetch: send as never }).exchangeCode("c", null),
    ).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Chart is sandbox only", () => {
  it("has no real connector and no switch, until counsel answers", () => {
    expect(allConnectors().filter((c) => c.id.includes("chart") && !c.sandbox)).toEqual([]);
    expect(Object.keys(REAL_CONNECTORS).filter((id) => id.includes("chart"))).toEqual([]);
  });

  it("reaches sample data only, with connectors on, and only reads", () => {
    const on = { CONNECTORS: "1" };
    expect(
      whyUnavailable(sandboxChartTranscripts, { userId: "u", sampleData: true }, on),
    ).toBeNull();
    expect(whyUnavailable(sandboxChartTranscripts, { userId: "u", sampleData: false }, on)).toBe(
      "sandbox_for_samples",
    );
    expect(whyUnavailable(sandboxChartTranscripts, { userId: "u", sampleData: true }, {})).toBe(
      "off",
    );
    expect(sandboxChartTranscripts.capabilities).toEqual(["read"]);
    expect(sandboxChartTranscripts.act).toBeUndefined();
  });
});

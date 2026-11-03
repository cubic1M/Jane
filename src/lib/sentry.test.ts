import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "@/lib/error-log";
import { parseDsn, reportToSentry, sentryEvent } from "@/lib/sentry";

afterEach(() => {
  vi.restoreAllMocks();
});

const DSN = "https://publickey@o1.ingest.sentry.io/42";

describe("parseDsn", () => {
  it("builds the envelope address", () => {
    expect(parseDsn(DSN)).toEqual({
      url: "https://o1.ingest.sentry.io/api/42/envelope/",
      key: "publickey",
    });
  });

  it("is off for nothing or for something else", () => {
    for (const dsn of [undefined, "", "  ", "not a url", "https://o1.ingest.sentry.io/42"]) {
      expect(parseDsn(dsn)).toBeNull();
    }
  });
});

describe("reportToSentry", () => {
  it("sends nothing without a DSN", async () => {
    const fetcher = vi.fn();
    await reportToSentry({ message: "Error: boom" }, { fetcher, env: {} });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never throws and never logs the DSN", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi.fn(() => Promise.reject(new TypeError(DSN)));
    await expect(
      reportToSentry({ message: "Error: boom" }, { fetcher, env: { SENTRY_DSN: DSN } }),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("publickey");
  });

  it("delivers an event a real server can read, holding nothing about a person", async () => {
    const received: { request: IncomingMessage; body: string }[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        received.push({ request, body });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    const thrown = new TypeError(
      `Bad row "STARBUCKS 12345" for sam@example.com, $1,240.50, user cmabc123def456ghi789jkl012, token access-production-abc`,
    );
    await reportToSentry(
      {
        ...describeError(thrown),
        path: "/report/cmabc123def456ghi789jkl012?email=sam@example.com",
        routeType: "route",
      },
      { env: { SENTRY_DSN: `http://publickey@127.0.0.1:${port}/42`, VERCEL_ENV: "production" } },
    );
    server.close();

    expect(received).toHaveLength(1);
    const [{ request, body }] = received;
    expect(request.url).toBe("/api/42/envelope/");
    expect(request.headers["x-sentry-auth"]).toContain("sentry_key=publickey");
    expect(body).not.toMatch(
      /STARBUCKS|12345|sam@example|1,240|cmabc123|access-production|example\.com/,
    );
    const [head, item, payload] = body.split("\n");
    const event = JSON.parse(payload);
    expect(JSON.parse(head).event_id).toBe(event.event_id);
    expect(JSON.parse(item)).toMatchObject({ type: "event", length: Buffer.byteLength(payload) });
    expect(event).toMatchObject({
      level: "error",
      environment: "production",
      transaction: "/report/:id",
    });
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.exception.values[0].type).toBe("TypeError");
    expect(event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  });
});

describe("sentryEvent", () => {
  it("keeps the kind and place of an error with no stack", () => {
    const event = sentryEvent({ message: "Error: boom" }, {});
    expect(event.exception.values[0]).toMatchObject({ type: "Error", value: "boom" });
    expect(event.transaction).toBe("(no path)");
  });
});

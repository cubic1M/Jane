import { ROBINHOOD_LIMITS, robinhoodServer } from "@/config/robinhood";
import { cappedText } from "./capped";

// The one way into Robinhood's MCP server (docs/setup/robinhood.md). Robinhood's only OAuth scope
// also lets a connection trade, so being read-only is decided here: READ_TOOLS is every tool Jane
// may call, and anything else, an order, a cancel, an unknown name, is refused before a request is
// sent. No other module may call the server (mcp-client.test.ts checks the source).
//
// The names come from Robinhood's support article "Trading with your agent", read 2026-11-05.
export const READ_TOOLS = Object.freeze([
  "get_accounts",
  "get_portfolio",
  "get_equity_positions",
  "get_equity_quotes",
  "get_equity_orders",
] as const);

export type ReadTool = (typeof READ_TOOLS)[number];

const isReadTool = (name: string): name is ReadTool =>
  (READ_TOOLS as readonly string[]).includes(name);

export class RefusedToolError extends Error {
  constructor() {
    super("That Robinhood tool isn't on Jane's read-only list.");
    this.name = "RefusedToolError";
  }
}

// Robinhood no longer takes the access token (HTTP 401).
export class RobinhoodSignedOutError extends Error {
  constructor() {
    super("Robinhood didn't accept the connection.");
    this.name = "RobinhoodSignedOutError";
  }
}

// A read that failed. `code` is ours: a status or a kind, never words from the server, which are
// untrusted and could hold anything.
export class RobinhoodReadError extends Error {
  constructor(readonly code: string) {
    super(`Robinhood read failed: ${code}`);
    this.name = "RobinhoodReadError";
  }
}

const PROTOCOL_VERSION = "2025-06-18";
const ACCEPT = "application/json, text/event-stream";

type RpcMethod = "initialize" | "tools/call";
type Reply = { id?: unknown; result?: unknown; error?: { code?: unknown } };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new RobinhoodReadError("not_json");
  }
}

// An event stream carries the reply as one of its `data:` lines.
function replyFromStream(text: string, id: number): Reply {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const reply = parseJson(line.slice(5).trim()) as Reply | null;
    if (reply && reply.id === id) return reply;
  }
  throw new RobinhoodReadError("no_reply");
}

// What a tool answered: its structured content, or the JSON in its first text block. The caller
// (parse.ts) trusts none of it.
function answerOf(result: unknown): unknown {
  const r = (result ?? {}) as {
    isError?: unknown;
    structuredContent?: unknown;
    content?: { type?: unknown; text?: unknown }[];
  };
  if (r.isError) throw new RobinhoodReadError("tool_error");
  if (r.structuredContent !== undefined) return r.structuredContent;
  const text = Array.isArray(r.content) ? r.content.find((c) => c?.type === "text")?.text : null;
  if (typeof text !== "string") throw new RobinhoodReadError("no_content");
  return parseJson(text);
}

export type RobinhoodReader = {
  read(tool: ReadTool, args?: Record<string, string>): Promise<unknown>;
};

// A reader for one refresh. The token stays in this closure, and goes only to the server's address.
export function openReader({
  accessToken,
  signal,
}: {
  accessToken: string;
  signal?: AbortSignal;
}): RobinhoodReader {
  const { mcpUrl } = robinhoodServer();
  let nextId = 1;
  let sessionId: string | null = null;
  let started: Promise<void> | null = null;

  async function post(body: object): Promise<Response> {
    const timeout = AbortSignal.timeout(ROBINHOOD_LIMITS.callTimeoutMs);
    try {
      const response = await fetch(mcpUrl, {
        method: "POST",
        // A redirect could carry the token to another address.
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: ACCEPT,
          "MCP-Protocol-Version": PROTOCOL_VERSION,
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
      if (response.status === 401) throw new RobinhoodSignedOutError();
      if (!response.ok) throw new RobinhoodReadError(`http_${response.status}`);
      return response;
    } catch (error) {
      if (error instanceof RobinhoodSignedOutError || error instanceof RobinhoodReadError) {
        throw error;
      }
      // Timed out, cut off or redirected: the kind only.
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new RobinhoodReadError(timedOut ? "timeout" : "unreachable");
    }
  }

  async function rpc(method: RpcMethod, params: object): Promise<unknown> {
    const id = nextId++;
    const response = await post({ jsonrpc: "2.0", id, method, params });
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    const text = await cappedText(response, ROBINHOOD_LIMITS.answerBytes);
    if (text === null) throw new RobinhoodReadError("too_large");
    const reply = (response.headers.get("content-type") ?? "").includes("text/event-stream")
      ? replyFromStream(text, id)
      : (parseJson(text) as Reply);
    if (reply?.error) {
      const code = typeof reply.error.code === "number" ? reply.error.code : "unknown";
      throw new RobinhoodReadError(`rpc_${code}`);
    }
    return reply?.result;
  }

  const start = () =>
    (started ??= (async () => {
      await rpc("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Jane", version: "1" },
      });
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })());

  return {
    async read(tool, args = {}) {
      // First, before anything is sent: the type is only a promise, and this is the rule.
      if (!isReadTool(tool)) throw new RefusedToolError();
      await start();
      return answerOf(await rpc("tools/call", { name: tool, arguments: args }));
    },
  };
}
